const express = require('express');
const { ECRClient, CreateRepositoryCommand, DescribeRepositoriesCommand, GetAuthorizationTokenCommand } = require('@aws-sdk/client-ecr');
const Docker = require('dockerode');
const { spawnSync } = require('child_process');
const { Buffer } = require('buffer');
const { logger } = require('../utils/logger');
const { validateECRPushRequest, validateECRRepository } = require('../middleware/validation');

const router = express.Router();
const docker = new Docker();

// Store active ECR operations
const activeECROperations = new Map();

// Create ECR repository if it doesn't exist
router.post('/create-repository', validateECRRepository, async (req, res) => {
  try {
    const { repositoryName, awsCredentials } = req.body;
    
    if (!repositoryName || !awsCredentials) {
      return res.status(400).json({
        success: false,
        error: 'Repository name and AWS credentials are required'
      });
    }
    
    const ecrClient = new ECRClient({
      region: awsCredentials.region,
      credentials: {
        accessKeyId: awsCredentials.accessKeyId || awsCredentials.accessKey,
        secretAccessKey: awsCredentials.secretAccessKey || awsCredentials.secretKey
      }
    });
    
    try {
      // Check if repository already exists
      const describeCommand = new DescribeRepositoriesCommand({
        repositoryNames: [repositoryName]
      });
      
      const existingRepo = await ecrClient.send(describeCommand);
      
      if (existingRepo.repositories && existingRepo.repositories.length > 0) {
        logger.info(`ECR repository ${repositoryName} already exists`);
        return res.json({
          success: true,
          repository: existingRepo.repositories[0],
          message: 'Repository already exists'
        });
      }
    } catch (error) {
      // Repository doesn't exist, we'll create it
      if (error.name !== 'RepositoryNotFoundException') {
        throw error;
      }
    }
    
    // Create new repository
    const createCommand = new CreateRepositoryCommand({
      repositoryName,
      imageScanningConfiguration: {
        scanOnPush: true
      },
      encryptionConfiguration: {
        encryptionType: 'AES256'
      }
    });
    
    const result = await ecrClient.send(createCommand);
    
    logger.info(`ECR repository ${repositoryName} created successfully`);
    
    res.json({
      success: true,
      repository: result.repository,
      message: 'Repository created successfully'
    });
    
  } catch (error) {
    logger.error('ECR repository creation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create ECR repository',
      message: error.message
    });
  }
});

// Push Docker image to ECR
router.post('/push-image', validateECRPushRequest, async (req, res) => {
  try {
    const { 
      imageName, 
      imageTag = 'latest', 
      repositoryName, 
      awsCredentials 
    } = req.body;
    
    const operationId = `${repositoryName}-${Date.now()}`;
    const ecrRegistry = `${awsCredentials.accountId}.dkr.ecr.${awsCredentials.region}.amazonaws.com`;
    const ecrImageName = `${ecrRegistry}/${repositoryName}:${imageTag}`;
    
    logger.info(`Starting ECR push for ${imageName} -> ${ecrImageName}`);
    
    // Store operation info
    activeECROperations.set(operationId, {
      id: operationId,
      status: 'authenticating',
      imageName,
      ecrImageName,
      repositoryName,
      startTime: new Date(),
      logs: []
    });
    
    // Emit initial status via WebSocket
    const io = req.io;
    const emitLog = (message, level = 'info') => {
      const logEntry = {
        timestamp: new Date(),
        message,
        level,
        operationId
      };
      activeECROperations.get(operationId).logs.push(logEntry);
      io.emit('ecr-log', logEntry);
    };
    
    emitLog(`Starting ECR push for ${imageName} -> ${ecrImageName}`, 'info');
    
    const ecrClient = new ECRClient({
      region: awsCredentials.region,
      credentials: {
        accessKeyId: awsCredentials.accessKeyId || awsCredentials.accessKey,
        secretAccessKey: awsCredentials.secretAccessKey || awsCredentials.secretKey
      }
    });
    
    // Get ECR authorization token
    const authCommand = new GetAuthorizationTokenCommand({});
    const authResult = await ecrClient.send(authCommand);
    
    if (!authResult.authorizationData || authResult.authorizationData.length === 0) {
      throw new Error('Failed to get ECR authorization token');
    }
    
    const authData = authResult.authorizationData[0];
    const token = authData.authorizationToken;
    const proxyEndpoint = authData.proxyEndpoint;
    const [username, password] = Buffer.from(token, 'base64').toString().split(':');
    
    // Update operation status
    activeECROperations.get(operationId).status = 'authenticating';
    emitLog('ECR authentication successful', 'info');
    
    // Docker login using spawnSync
    emitLog(`Logging into ECR registry: ${proxyEndpoint}`, 'info');
    const loginResult = spawnSync('docker', ['login', '-u', username, '-p', password, proxyEndpoint], { 
      stdio: 'pipe',
      encoding: 'utf8'
    });
    
    if (loginResult.status !== 0) {
      const errorMsg = loginResult.stderr || 'Docker login failed';
      emitLog(`Docker login failed: ${errorMsg}`, 'error');
      throw new Error(`Docker login failed: ${errorMsg}`);
    }
    
    emitLog('Docker login successful', 'info');
    
    // Update operation status
    activeECROperations.get(operationId).status = 'tagging';
    
    // Tag the image for ECR using spawnSync
    emitLog(`Tagging image ${imageName} as ${ecrImageName}`, 'info');
    const tagResult = spawnSync('docker', ['tag', imageName, ecrImageName], { 
      stdio: 'pipe',
      encoding: 'utf8'
    });
    
    if (tagResult.status !== 0) {
      const errorMsg = tagResult.stderr || 'Docker tag failed';
      emitLog(`Docker tag failed: ${errorMsg}`, 'error');
      throw new Error(`Docker tag failed: ${errorMsg}`);
    }
    
    emitLog(`Image tagged successfully as ${ecrImageName}`, 'info');
    
    // Update operation status
    activeECROperations.get(operationId).status = 'pushing';
    
    // Push image to ECR using spawnSync
    emitLog(`Pushing image to ECR: ${ecrImageName}`, 'info');
    const pushResult = spawnSync('docker', ['push', ecrImageName], { 
      stdio: 'pipe',
      encoding: 'utf8'
    });
    
    if (pushResult.status !== 0) {
      const errorMsg = pushResult.stderr || 'Docker push failed';
      emitLog(`Docker push failed: ${errorMsg}`, 'error');
      throw new Error(`Docker push failed: ${errorMsg}`);
    }
    
    // Update operation status
    activeECROperations.get(operationId).status = 'completed';
    activeECROperations.get(operationId).completedAt = new Date();
    emitLog(`✅ Image pushed successfully to ${ecrImageName}`, 'info');
    
    res.json({
      success: true,
      operationId,
      ecrImageName,
      registry: ecrRegistry,
      repository: repositoryName,
      tag: imageTag,
      status: 'completed'
    });
    
  } catch (error) {
    logger.error('ECR push failed:', error);
    
    const operationId = req.body.operationId;
    if (operationId && activeECROperations.has(operationId)) {
      activeECROperations.get(operationId).status = 'failed';
      activeECROperations.get(operationId).error = error.message;
    }
    
    res.status(500).json({
      success: false,
      error: 'ECR push failed',
      message: error.message
    });
  }
});

// Get ECR operation status
router.get('/operation-status/:operationId', (req, res) => {
  const { operationId } = req.params;
  const operation = activeECROperations.get(operationId);
  
  if (!operation) {
    return res.status(404).json({
      success: false,
      error: 'Operation not found'
    });
  }
  
  res.json({
    success: true,
    operation: {
      id: operation.id,
      status: operation.status,
      imageName: operation.imageName,
      ecrImageName: operation.ecrImageName,
      repositoryName: operation.repositoryName,
      startTime: operation.startTime,
      completedAt: operation.completedAt,
      error: operation.error,
      logs: operation.logs
    }
  });
});

// Get ECR operation logs
router.get('/operation-logs/:operationId', (req, res) => {
  const { operationId } = req.params;
  const operation = activeECROperations.get(operationId);
  
  if (!operation) {
    return res.status(404).json({
      success: false,
      error: 'Operation not found'
    });
  }
  
  res.json({
    success: true,
    logs: operation.logs || []
  });
});

module.exports = router;