const express = require('express');
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
const { ECRClient, GetAuthorizationTokenCommand, CreateRepositoryCommand, DescribeRepositoriesCommand } = require('@aws-sdk/client-ecr');
const { EKSClient, DescribeClusterCommand, ListClustersCommand } = require('@aws-sdk/client-eks');
const { logger } = require('../utils/logger');
const { validateAWSCredentials } = require('../middleware/validation');

const router = express.Router();

// Validate AWS credentials
router.post('/validate-credentials', validateAWSCredentials, async (req, res) => {
  try {
    const { accessKeyId, secretAccessKey, region } = req.body;
    
    // Comprehensive logging for debugging
    logger.info('Validation request received:', {
      hasAccessKeyId: !!accessKeyId,
      accessKeyIdLength: accessKeyId ? accessKeyId.length : 0,
      accessKeyIdType: typeof accessKeyId,
      hasSecretAccessKey: !!secretAccessKey,
      secretAccessKeyLength: secretAccessKey ? secretAccessKey.length : 0,
      secretAccessKeyType: typeof secretAccessKey,
      region: region,
      regionType: typeof region
    });
    
    // Validate that credentials are not empty or undefined
    if (!accessKeyId || !secretAccessKey || !region) {
      logger.error('Missing credentials detected:', { accessKeyId: !!accessKeyId, secretAccessKey: !!secretAccessKey, region: !!region });
      return res.status(400).json({
        success: false,
        error: 'Missing required credentials'
      });
    }
    
    // Additional validation for credential format
    if (typeof accessKeyId !== 'string' || typeof secretAccessKey !== 'string' || typeof region !== 'string') {
      logger.error('Invalid credential types detected');
      return res.status(400).json({
        success: false,
        error: 'Invalid credential types'
      });
    }
    
    // Trim whitespace from credentials
    const trimmedAccessKeyId = accessKeyId.trim();
    const trimmedSecretAccessKey = secretAccessKey.trim();
    const trimmedRegion = region.trim();
    
    logger.info('Creating STS client with trimmed credentials');
    
    const stsClient = new STSClient({
      region: trimmedRegion,
      credentials: {
        accessKeyId: trimmedAccessKeyId,
        secretAccessKey: trimmedSecretAccessKey
      }
    });
    
    logger.info('Sending GetCallerIdentity command');
    const command = new GetCallerIdentityCommand({});
    const response = await stsClient.send(command);
    
    logger.info('AWS credentials validated successfully');
    
    logger.info(`AWS credentials validated for account: ${response.Account}`);
    
    res.json({
      success: true,
      account: response.Account,
      userId: response.UserId,
      arn: response.Arn,
      region
    });
  } catch (error) {
    logger.error('AWS credential validation failed:', error);
    
    let errorMessage = 'Invalid AWS credentials';
    let statusCode = 401;
    
    if (error.name === 'CredentialsProviderError') {
      errorMessage = 'AWS credentials are invalid or malformed';
    } else if (error.name === 'UnrecognizedClientException') {
      errorMessage = 'AWS Access Key ID not found';
    } else if (error.name === 'InvalidSignatureException') {
      errorMessage = 'AWS Secret Access Key is incorrect';
    } else if (error.name === 'TokenRefreshRequiredError') {
      errorMessage = 'AWS credentials have expired';
    } else if (error.message && error.message.includes('Resolved credential object is not valid')) {
      errorMessage = 'AWS credentials format is invalid. Please check your Access Key ID and Secret Access Key.';
      statusCode = 400;
    } else if (error.name === 'NetworkingError') {
      errorMessage = 'Network error occurred while validating credentials';
      statusCode = 503;
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get ECR authorization token
router.post('/ecr/auth-token', validateAWSCredentials, async (req, res) => {
  try {
    const { accessKeyId, secretAccessKey, region } = req.body;
    
    const ecrClient = new ECRClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });
    
    const command = new GetAuthorizationTokenCommand({});
    const response = await ecrClient.send(command);
    
    const authData = response.authorizationData[0];
    const token = Buffer.from(authData.authorizationToken, 'base64').toString('utf-8');
    const [username, password] = token.split(':');
    
    res.json({
      success: true,
      registry: authData.proxyEndpoint,
      username,
      password,
      expiresAt: authData.expiresAt
    });
  } catch (error) {
    logger.error('ECR auth token retrieval failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get ECR authorization token',
      message: error.message
    });
  }
});

// Create ECR repository
router.post('/ecr/create-repository', validateAWSCredentials, async (req, res) => {
  try {
    const { accessKeyId, secretAccessKey, region, repositoryName } = req.body;
    
    const ecrClient = new ECRClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });
    
    // Check if repository already exists
    try {
      const describeCommand = new DescribeRepositoriesCommand({
        repositoryNames: [repositoryName]
      });
      const existingRepo = await ecrClient.send(describeCommand);
      
      return res.json({
        success: true,
        repository: existingRepo.repositories[0],
        existed: true
      });
    } catch (error) {
      // Repository doesn't exist, create it
      if (error.name !== 'RepositoryNotFoundException') {
        throw error;
      }
    }
    
    const createCommand = new CreateRepositoryCommand({
      repositoryName,
      imageScanningConfiguration: {
        scanOnPush: true
      },
      encryptionConfiguration: {
        encryptionType: 'AES256'
      }
    });
    
    const response = await ecrClient.send(createCommand);
    
    logger.info(`ECR repository created: ${repositoryName}`);
    
    res.json({
      success: true,
      repository: response.repository,
      existed: false
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

// List EKS clusters
router.post('/eks/list-clusters', validateAWSCredentials, async (req, res) => {
  try {
    const { accessKeyId, secretAccessKey, region } = req.body;
    
    const eksClient = new EKSClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });
    
    const command = new ListClustersCommand({});
    const response = await eksClient.send(command);
    
    res.json({
      success: true,
      clusters: response.clusters || []
    });
  } catch (error) {
    logger.error('EKS cluster listing failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list EKS clusters',
      message: error.message
    });
  }
});

// Get EKS cluster details
router.post('/eks/describe-cluster', validateAWSCredentials, async (req, res) => {
  try {
    const { accessKeyId, secretAccessKey, region, clusterName } = req.body;
    
    const eksClient = new EKSClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });
    
    const command = new DescribeClusterCommand({ name: clusterName });
    const response = await eksClient.send(command);
    
    res.json({
      success: true,
      cluster: response.cluster
    });
  } catch (error) {
    logger.error('EKS cluster description failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to describe EKS cluster',
      message: error.message
    });
  }
});

// Get AWS regions
router.get('/regions', (req, res) => {
  const regions = [
    { value: 'us-east-1', label: 'US East (N. Virginia)', flag: '🇺🇸' },
    { value: 'us-east-2', label: 'US East (Ohio)', flag: '🇺🇸' },
    { value: 'us-west-1', label: 'US West (N. California)', flag: '🇺🇸' },
    { value: 'us-west-2', label: 'US West (Oregon)', flag: '🇺🇸' },
    { value: 'ap-south-1', label: 'Asia Pacific (Mumbai)', flag: '🇮🇳' },
    { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)', flag: '🇯🇵' },
    { value: 'ap-northeast-2', label: 'Asia Pacific (Seoul)', flag: '🇰🇷' },
    { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)', flag: '🇸🇬' },
    { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney)', flag: '🇦🇺' },
    { value: 'eu-central-1', label: 'Europe (Frankfurt)', flag: '🇩🇪' },
    { value: 'eu-west-1', label: 'Europe (Ireland)', flag: '🇮🇪' },
    { value: 'eu-west-2', label: 'Europe (London)', flag: '🇬🇧' },
    { value: 'eu-west-3', label: 'Europe (Paris)', flag: '🇫🇷' },
    { value: 'ca-central-1', label: 'Canada (Central)', flag: '🇨🇦' },
    { value: 'sa-east-1', label: 'South America (São Paulo)', flag: '🇧🇷' }
  ];
  
  res.json({ success: true, regions });
});

module.exports = router;