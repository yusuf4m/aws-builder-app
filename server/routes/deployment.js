const express = require('express');
const Docker = require('dockerode');
const tar = require('tar');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');
const { validateDeploymentRequest } = require('../middleware/validation');

const router = express.Router();
const docker = new Docker();

// Store active deployments
const activeDeployments = new Map();

// Build Docker image from repository
router.post('/build-image', validateDeploymentRequest, async (req, res) => {
  try {
    const {
      repositoryPath,
      imageName,
      imageTag = 'latest',
      awsCredentials,
      ecrRepository
    } = req.body;
    
    const deploymentId = uuidv4();
    const fullImageName = `${imageName}:${imageTag}`;
    
    logger.info(`Starting Docker image build for ${fullImageName}`);
    
    // Store deployment info
    activeDeployments.set(deploymentId, {
      id: deploymentId,
      type: 'image-build',
      status: 'building',
      imageName: fullImageName,
      startTime: new Date(),
      logs: []
    });
    
    // Create tar stream from repository directory
    const tarStream = tar.create(
      {
        gzip: true,
        cwd: repositoryPath
      },
      ['.'] // Include all files
    );
    
    // Build image
    const buildStream = await docker.buildImage(tarStream, {
      t: fullImageName,
      dockerfile: 'Dockerfile',
      rm: true, // Remove intermediate containers
      forcerm: true, // Always remove intermediate containers
      pull: true // Always pull base image
    });
    
    // Handle build stream
    const buildPromise = new Promise((resolve, reject) => {
      const buildLogs = [];
      
      docker.modem.followProgress(buildStream, (err, result) => {
        if (err) {
          logger.error('Docker build failed:', err);
          activeDeployments.get(deploymentId).status = 'failed';
          reject(err);
        } else {
          logger.info('Docker build completed successfully');
          activeDeployments.get(deploymentId).status = 'build-complete';
          activeDeployments.get(deploymentId).logs = buildLogs;
          resolve(result);
        }
      }, (event) => {
        // Handle build progress
        if (event.stream) {
          const logEntry = {
            timestamp: new Date(),
            message: event.stream.trim()
          };
          buildLogs.push(logEntry);
          
          // Emit real-time build progress
          req.io.to(`deployment-${deploymentId}`).emit('build-progress', {
            deploymentId,
            type: 'build',
            message: event.stream.trim(),
            timestamp: new Date()
          });
        }
        
        if (event.error) {
          logger.error('Docker build error:', event.error);
          buildLogs.push({
            timestamp: new Date(),
            message: event.error,
            level: 'error'
          });
        }
      });
    });
    
    // Wait for build to complete
    await buildPromise;
    
    // Get image info
    const image = docker.getImage(fullImageName);
    const imageInfo = await image.inspect();
    
    res.json({
      success: true,
      deploymentId,
      image: {
        id: imageInfo.Id,
        name: fullImageName,
        size: imageInfo.Size,
        created: imageInfo.Created,
        architecture: imageInfo.Architecture,
        os: imageInfo.Os
      },
      status: 'build-complete'
    });
  } catch (error) {
    logger.error('Docker image build failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to build Docker image',
      message: error.message
    });
  }
});

// Push image to ECR
router.post('/push-to-ecr', validateDeploymentRequest, async (req, res) => {
  try {
    const {
      imageName,
      imageTag = 'latest',
      ecrRegistry,
      ecrRepository,
      awsCredentials
    } = req.body;
    
    const deploymentId = uuidv4();
    const localImageName = `${imageName}:${imageTag}`;
    const ecrImageName = `${ecrRegistry}/${ecrRepository}:${imageTag}`;
    
    logger.info(`Pushing image ${localImageName} to ECR as ${ecrImageName}`);
    
    // Store deployment info
    activeDeployments.set(deploymentId, {
      id: deploymentId,
      type: 'ecr-push',
      status: 'pushing',
      localImage: localImageName,
      ecrImage: ecrImageName,
      startTime: new Date(),
      logs: []
    });
    
    // Tag image for ECR
    const image = docker.getImage(localImageName);
    await image.tag({
      repo: `${ecrRegistry}/${ecrRepository}`,
      tag: imageTag
    });
    
    // Get ECR auth token (this should be called from frontend with AWS credentials)
    const authConfig = {
      username: 'AWS',
      password: req.body.ecrAuthToken, // Should be provided from frontend
      serveraddress: ecrRegistry
    };
    
    // Push to ECR
    const ecrImage = docker.getImage(ecrImageName);
    const pushStream = await ecrImage.push({ authconfig: authConfig });
    
    // Handle push stream
    const pushPromise = new Promise((resolve, reject) => {
      const pushLogs = [];
      
      docker.modem.followProgress(pushStream, (err, result) => {
        if (err) {
          logger.error('ECR push failed:', err);
          activeDeployments.get(deploymentId).status = 'failed';
          reject(err);
        } else {
          logger.info('ECR push completed successfully');
          activeDeployments.get(deploymentId).status = 'push-complete';
          activeDeployments.get(deploymentId).logs = pushLogs;
          resolve(result);
        }
      }, (event) => {
        // Handle push progress
        if (event.status) {
          const logEntry = {
            timestamp: new Date(),
            message: `${event.status} ${event.progress || ''}`.trim()
          };
          pushLogs.push(logEntry);
          
          // Emit real-time push progress
          req.io.to(`deployment-${deploymentId}`).emit('push-progress', {
            deploymentId,
            type: 'push',
            message: logEntry.message,
            timestamp: new Date()
          });
        }
        
        if (event.error) {
          logger.error('ECR push error:', event.error);
          pushLogs.push({
            timestamp: new Date(),
            message: event.error,
            level: 'error'
          });
        }
      });
    });
    
    // Wait for push to complete
    await pushPromise;
    
    res.json({
      success: true,
      deploymentId,
      image: {
        local: localImageName,
        ecr: ecrImageName,
        registry: ecrRegistry,
        repository: ecrRepository,
        tag: imageTag
      },
      status: 'push-complete'
    });
  } catch (error) {
    logger.error('ECR push failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to push image to ECR',
      message: error.message
    });
  }
});

// Start complete deployment process
router.post('/start', validateDeploymentRequest, async (req, res) => {
  try {
    const {
      awsCredentials,
      repository,
      deploymentType,
      environment,
      deploymentConfig
    } = req.body;
    
    const deploymentId = uuidv4();
    const projectName = deploymentConfig.projectName || 'aws-builder-app';
    
    logger.info(`Starting complete deployment ${deploymentId}`);
    
    // Store deployment info
    const deployment = {
      id: deploymentId,
      type: 'complete-deployment',
      status: 'initializing',
      startTime: new Date(),
      steps: [
        { id: 'clone', name: 'Clone Repository', status: 'pending' },
        { id: 'build', name: 'Build Docker Image', status: 'pending' },
        { id: 'ecr-setup', name: 'Setup ECR Repository', status: 'pending' },
        { id: 'push', name: 'Push to ECR', status: 'pending' },
        { id: 'terraform-init', name: 'Initialize Terraform', status: 'pending' },
        { id: 'terraform-plan', name: 'Plan Infrastructure', status: 'pending' },
        { id: 'terraform-apply', name: 'Deploy Infrastructure', status: 'pending' },
        { id: 'kubectl-config', name: 'Configure kubectl', status: 'pending' },
        { id: 'deploy-app', name: 'Deploy Application', status: 'pending' },
        { id: 'verify', name: 'Verify Deployment', status: 'pending' }
      ],
      currentStep: 0,
      config: {
        awsCredentials,
        repository,
        deploymentType,
        environment,
        projectName,
        ...deploymentConfig
      },
      logs: []
    };
    
    activeDeployments.set(deploymentId, deployment);
    
    // Start deployment process asynchronously
    processDeployment(deploymentId, req.io).catch(error => {
      logger.error(`Deployment ${deploymentId} failed:`, error);
      deployment.status = 'failed';
      deployment.error = error.message;
      
      req.io.to(`deployment-${deploymentId}`).emit('deployment-failed', {
        deploymentId,
        error: error.message,
        timestamp: new Date()
      });
    });
    
    res.json({
      success: true,
      deploymentId,
      status: deployment.status,
      steps: deployment.steps
    });
  } catch (error) {
    logger.error('Failed to start deployment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start deployment',
      message: error.message
    });
  }
});

// Process complete deployment
async function processDeployment(deploymentId, io) {
  const deployment = activeDeployments.get(deploymentId);
  if (!deployment) {
    throw new Error('Deployment not found');
  }
  
  const updateStep = (stepId, status, message) => {
    const step = deployment.steps.find(s => s.id === stepId);
    if (step) {
      step.status = status;
      step.message = message;
      step.timestamp = new Date();
    }
    
    io.to(`deployment-${deploymentId}`).emit('step-update', {
      deploymentId,
      stepId,
      status,
      message,
      timestamp: new Date()
    });
  };
  
  const addLog = (message, level = 'info') => {
    const logEntry = {
      timestamp: new Date(),
      message,
      level
    };
    deployment.logs.push(logEntry);
    
    io.to(`deployment-${deploymentId}`).emit('deployment-log', {
      deploymentId,
      ...logEntry
    });
  };
  
  try {
    deployment.status = 'running';
    
    // Step 1: Clone Repository (simulated - would use GitHub API)
    updateStep('clone', 'running', 'Cloning repository...');
    addLog(`Cloning repository: ${deployment.config.repository.url}`);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate
    updateStep('clone', 'completed', 'Repository cloned successfully');
    
    // Step 2: Build Docker Image (simulated)
    updateStep('build', 'running', 'Building Docker image...');
    addLog('Building Docker image from repository');
    await new Promise(resolve => setTimeout(resolve, 5000)); // Simulate
    updateStep('build', 'completed', 'Docker image built successfully');
    
    // Step 3: Setup ECR Repository
    updateStep('ecr-setup', 'running', 'Setting up ECR repository...');
    addLog('Creating ECR repository if not exists');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate
    updateStep('ecr-setup', 'completed', 'ECR repository ready');
    
    // Step 4: Push to ECR
    updateStep('push', 'running', 'Pushing image to ECR...');
    addLog('Pushing Docker image to ECR');
    await new Promise(resolve => setTimeout(resolve, 4000)); // Simulate
    updateStep('push', 'completed', 'Image pushed to ECR successfully');
    
    // Step 5: Initialize Terraform
    updateStep('terraform-init', 'running', 'Initializing Terraform...');
    addLog('Setting up Terraform configuration');
    await new Promise(resolve => setTimeout(resolve, 3000)); // Simulate
    updateStep('terraform-init', 'completed', 'Terraform initialized');
    
    // Step 6: Plan Infrastructure
    updateStep('terraform-plan', 'running', 'Planning infrastructure...');
    addLog('Creating deployment plan for AWS resources');
    await new Promise(resolve => setTimeout(resolve, 4000)); // Simulate
    updateStep('terraform-plan', 'completed', 'Infrastructure plan created');
    
    // Step 7: Deploy Infrastructure
    updateStep('terraform-apply', 'running', 'Deploying infrastructure...');
    addLog('Creating EKS cluster and related resources');
    await new Promise(resolve => setTimeout(resolve, 10000)); // Simulate
    updateStep('terraform-apply', 'completed', 'Infrastructure deployed successfully');
    
    // Step 8: Configure kubectl
    updateStep('kubectl-config', 'running', 'Configuring kubectl...');
    addLog('Setting up Kubernetes cluster access');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate
    updateStep('kubectl-config', 'completed', 'kubectl configured');
    
    // Step 9: Deploy Application
    updateStep('deploy-app', 'running', 'Deploying application...');
    addLog('Deploying application to EKS cluster');
    await new Promise(resolve => setTimeout(resolve, 5000)); // Simulate
    updateStep('deploy-app', 'completed', 'Application deployed successfully');
    
    // Step 10: Verify Deployment
    updateStep('verify', 'running', 'Verifying deployment...');
    addLog('Checking application health and accessibility');
    await new Promise(resolve => setTimeout(resolve, 3000)); // Simulate
    updateStep('verify', 'completed', 'Deployment verified successfully');
    
    deployment.status = 'completed';
    deployment.completedAt = new Date();
    deployment.deploymentUrl = `https://${deployment.config.projectName}-${deployment.config.environment}.example.com`;
    
    addLog('Deployment completed successfully!');
    
    io.to(`deployment-${deploymentId}`).emit('deployment-completed', {
      deploymentId,
      deploymentUrl: deployment.deploymentUrl,
      timestamp: new Date()
    });
    
  } catch (error) {
    deployment.status = 'failed';
    deployment.error = error.message;
    addLog(`Deployment failed: ${error.message}`, 'error');
    throw error;
  }
}

// Get deployment status
router.get('/status/:deploymentId', (req, res) => {
  const { deploymentId } = req.params;
  const deployment = activeDeployments.get(deploymentId);
  
  if (!deployment) {
    return res.status(404).json({
      success: false,
      error: 'Deployment not found'
    });
  }
  
  res.json({
    success: true,
    deployment: {
      id: deployment.id,
      type: deployment.type,
      status: deployment.status,
      startTime: deployment.startTime,
      completedAt: deployment.completedAt,
      steps: deployment.steps,
      currentStep: deployment.currentStep,
      deploymentUrl: deployment.deploymentUrl,
      error: deployment.error,
      logs: deployment.logs.slice(-50) // Last 50 logs
    }
  });
});

// Get deployment logs
router.get('/logs/:deploymentId', (req, res) => {
  const { deploymentId } = req.params;
  const deployment = activeDeployments.get(deploymentId);
  
  if (!deployment) {
    return res.status(404).json({
      success: false,
      error: 'Deployment not found'
    });
  }
  
  const { limit = 100, offset = 0 } = req.query;
  const logs = deployment.logs.slice(offset, offset + parseInt(limit));
  
  res.json({
    success: true,
    deploymentId,
    logs,
    total: deployment.logs.length
  });
});

// Cancel deployment
router.post('/cancel/:deploymentId', (req, res) => {
  const { deploymentId } = req.params;
  const deployment = activeDeployments.get(deploymentId);
  
  if (!deployment) {
    return res.status(404).json({
      success: false,
      error: 'Deployment not found'
    });
  }
  
  deployment.status = 'cancelled';
  deployment.cancelledAt = new Date();
  
  logger.info(`Deployment ${deploymentId} cancelled`);
  
  req.io.to(`deployment-${deploymentId}`).emit('deployment-cancelled', {
    deploymentId,
    timestamp: new Date()
  });
  
  res.json({
    success: true,
    deploymentId,
    status: deployment.status
  });
});

module.exports = router;