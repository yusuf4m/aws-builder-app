const Joi = require('joi');
const { logger } = require('../utils/logger');

// AWS Credentials validation schema
const awsCredentialsSchema = Joi.object({
  accessKeyId: Joi.string().required().min(16).max(32).pattern(/^[A-Za-z0-9]+$/),
  secretAccessKey: Joi.string().required().min(28).max(64),
  sessionToken: Joi.string().optional().allow(''),
  region: Joi.string().required().min(2).max(20).pattern(/^[a-z0-9-]+$/)
});

// Repository validation schema
const repositorySchema = Joi.object({
  url: Joi.string().uri().required(),
  branch: Joi.string().required().min(1).max(100),
  owner: Joi.string().required().min(1).max(100),
  name: Joi.string().required().min(1).max(100),
  accessToken: Joi.string().optional().allow(''),
  isPrivate: Joi.boolean().default(false)
});

// Deployment configuration schema
const deploymentConfigSchema = Joi.object({
  projectName: Joi.string().required().min(1).max(50).pattern(/^[a-z0-9-]+$/),
  environment: Joi.string().valid('dev', 'staging', 'prod').required(),
  deploymentType: Joi.string().valid('eks', 'fargate', 'ec2').required(),
  
  // EKS specific configuration
  eksConfig: Joi.when('deploymentType', {
    is: 'eks',
    then: Joi.object({
      clusterName: Joi.string().required().min(1).max(100).pattern(/^[a-zA-Z0-9-]+$/),
      nodeGroupName: Joi.string().required().min(1).max(100).pattern(/^[a-zA-Z0-9-]+$/),
      instanceType: Joi.string().required().valid(
        't3.micro', 't3.small', 't3.medium', 't3.large',
        'm5.large', 'm5.xlarge', 'm5.2xlarge',
        'c5.large', 'c5.xlarge', 'c5.2xlarge'
      ),
      minSize: Joi.number().integer().min(1).max(10).default(1),
      maxSize: Joi.number().integer().min(1).max(20).default(3),
      desiredSize: Joi.number().integer().min(1).max(10).default(2),
      kubernetesVersion: Joi.string().valid('1.28', '1.29', '1.30').default('1.29')
    }).required(),
    otherwise: Joi.forbidden()
  }),
  
  // Networking configuration
  networkConfig: Joi.object({
    vpcCidr: Joi.string().pattern(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/).default('10.0.0.0/16'),
    publicSubnets: Joi.array().items(Joi.string().pattern(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/)).min(2).max(4).default(['10.0.1.0/24', '10.0.2.0/24']),
    privateSubnets: Joi.array().items(Joi.string().pattern(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/)).min(2).max(4).default(['10.0.10.0/24', '10.0.20.0/24']),
    enableNatGateway: Joi.boolean().default(true),
    enableVpnGateway: Joi.boolean().default(false)
  }).default(),
  
  // Application configuration
  appConfig: Joi.object({
    containerPort: Joi.number().integer().min(1).max(65535).default(3000),
    healthCheckPath: Joi.string().default('/health'),
    environmentVariables: Joi.object().pattern(Joi.string(), Joi.string()).default({}),
    secrets: Joi.object().pattern(Joi.string(), Joi.string()).default({}),
    replicas: Joi.number().integer().min(1).max(10).default(2),
    resources: Joi.object({
      requests: Joi.object({
        cpu: Joi.string().default('100m'),
        memory: Joi.string().default('128Mi')
      }).default(),
      limits: Joi.object({
        cpu: Joi.string().default('500m'),
        memory: Joi.string().default('512Mi')
      }).default()
    }).default()
  }).default(),
  
  // Load balancer configuration
  loadBalancerConfig: Joi.object({
    enabled: Joi.boolean().default(true),
    type: Joi.string().valid('application', 'network').default('application'),
    scheme: Joi.string().valid('internet-facing', 'internal').default('internet-facing'),
    certificateArn: Joi.string().optional().allow(''),
    sslPolicy: Joi.string().default('ELBSecurityPolicy-TLS-1-2-2017-01')
  }).default(),
  
  // Monitoring configuration
  monitoringConfig: Joi.object({
    enabled: Joi.boolean().default(true),
    cloudWatchLogs: Joi.boolean().default(true),
    prometheusMetrics: Joi.boolean().default(false),
    alerting: Joi.boolean().default(false)
  }).default()
});

// Complete deployment request schema
const deploymentRequestSchema = Joi.object({
  awsCredentials: awsCredentialsSchema.required(),
  repository: repositorySchema.required(),
  deploymentType: Joi.string().valid('eks', 'fargate', 'ec2').required(),
  environment: Joi.string().valid('dev', 'staging', 'prod').required(),
  deploymentConfig: deploymentConfigSchema.required()
});

// Docker build request schema
const dockerBuildSchema = Joi.object({
  repositoryPath: Joi.string().required(),
  imageName: Joi.string().required().min(1).max(100).pattern(/^[a-z0-9-\/]+$/),
  imageTag: Joi.string().default('latest').pattern(/^[a-zA-Z0-9._-]+$/),
  dockerfile: Joi.string().default('Dockerfile'),
  buildArgs: Joi.object().pattern(Joi.string(), Joi.string()).default({}),
  awsCredentials: awsCredentialsSchema.required(),
  ecrRepository: Joi.string().required().pattern(/^[a-z0-9-\/]+$/),
  accessToken: Joi.string().optional().allow('')
});

// Docker build request schema
const dockerBuildRequestSchema = Joi.object({
  url: Joi.string().uri().required(),
  branch: Joi.string().required().min(1).max(100),
  accessToken: Joi.string().optional().allow(''),
  imageName: Joi.string().optional().min(1).max(100).pattern(/^[a-z0-9-]+$/),
  imageTag: Joi.string().optional().default('latest').pattern(/^[a-zA-Z0-9._-]+$/),
  awsCredentials: Joi.object({
    accessKey: Joi.string().optional(),
    secretKey: Joi.string().optional(),
    region: Joi.string().optional(),
    accountId: Joi.string().optional()
  }).optional()
});

// ECR push request schema
const ecrPushRequestSchema = Joi.object({
  imageName: Joi.string().required(),
  imageTag: Joi.string().default('latest').pattern(/^[a-zA-Z0-9._-]+$/),
  repositoryName: Joi.string().required().pattern(/^[a-z0-9-\/]+$/),
  awsCredentials: Joi.object({
    accessKeyId: Joi.string().optional(),
    secretAccessKey: Joi.string().optional(),
    accessKey: Joi.string().optional(),
    secretKey: Joi.string().optional(),
    region: Joi.string().required(),
    accountId: Joi.string().optional()
  }).required()
});

// Deployment-specific ECR push schema (for internal deployment process)
const deploymentECRPushSchema = Joi.object({
  imageName: Joi.string().required(),
  imageTag: Joi.string().default('latest').pattern(/^[a-zA-Z0-9._-]+$/),
  ecrRegistry: Joi.string().required(),
  ecrRepository: Joi.string().required().pattern(/^[a-z0-9-\/]+$/),
  ecrAuthToken: Joi.string().required(),
  awsCredentials: Joi.object({
    accessKeyId: Joi.string().required(),
    secretAccessKey: Joi.string().required(),
    region: Joi.string().required()
  }).required()
});

// ECR repository creation schema
const ecrRepositorySchema = Joi.object({
  repositoryName: Joi.string().required().min(2).max(256).pattern(/^[a-z0-9-\/]+$/),
  awsCredentials: Joi.object({
    accessKeyId: Joi.string().required(),
    secretAccessKey: Joi.string().required(),
    region: Joi.string().required()
  }).required()
});

// Terraform operation schema
const terraformOperationSchema = Joi.object({
  operation: Joi.string().valid('init', 'plan', 'apply', 'destroy').required(),
  workingDirectory: Joi.string().required(),
  variables: Joi.object().pattern(Joi.string(), Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean())).default({}),
  autoApprove: Joi.boolean().default(false),
  awsCredentials: awsCredentialsSchema.required()
});

// GitHub repository validation schema
const githubRepoSchema = Joi.object({
  owner: Joi.string().required().min(1).max(100),
  repo: Joi.string().required().min(1).max(100),
  accessToken: Joi.string().optional().allow(''),
  branch: Joi.string().default('main')
});

// GitHub request schema for URL-based requests
const githubRequestSchema = Joi.object({
  url: Joi.string().uri().required(),
  accessToken: Joi.string().optional().allow(''),
  branch: Joi.string().optional().allow('').default('main')
});

// Validation middleware factory
const createValidationMiddleware = (schema, options = {}) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      allowUnknown: options.allowUnknown || false,
      stripUnknown: options.stripUnknown || true,
      ...options
    });
    
    if (error) {
      const errorDetails = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));
      
      logger.warn('Validation failed', {
        endpoint: req.path,
        method: req.method,
        errors: errorDetails,
        requestId: req.id
      });
      
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errorDetails
      });
    }
    
    // Replace req.body with validated and sanitized data
    req.body = value;
    next();
  };
};

// Specific validation middlewares
const validateAWSCredentials = createValidationMiddleware(awsCredentialsSchema);
const validateRepository = createValidationMiddleware(repositorySchema);
const validateDeploymentConfig = createValidationMiddleware(deploymentConfigSchema);
const validateDeploymentRequest = createValidationMiddleware(deploymentRequestSchema);
const validateDockerBuild = createValidationMiddleware(dockerBuildSchema);
const validateECRPushRequest = createValidationMiddleware(ecrPushRequestSchema);
const validateDeploymentECRPush = createValidationMiddleware(deploymentECRPushSchema);
const validateECRRepository = createValidationMiddleware(ecrRepositorySchema);
const validateTerraformOperation = createValidationMiddleware(terraformOperationSchema);
const validateGitHubRepo = createValidationMiddleware(githubRepoSchema);
const validateGitHubRequest = createValidationMiddleware(githubRequestSchema);
const validateDockerBuildRequest = createValidationMiddleware(dockerBuildRequestSchema);

// Parameter validation middleware
const validateParams = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.params, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true
    });
    
    if (error) {
      const errorDetails = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));
      
      logger.warn('Parameter validation failed', {
        endpoint: req.path,
        method: req.method,
        errors: errorDetails,
        requestId: req.id
      });
      
      return res.status(400).json({
        success: false,
        error: 'Parameter validation failed',
        details: errorDetails
      });
    }
    
    req.params = value;
    next();
  };
};

// Query parameter validation middleware
const validateQuery = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true
    });
    
    if (error) {
      const errorDetails = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));
      
      logger.warn('Query validation failed', {
        endpoint: req.path,
        method: req.method,
        errors: errorDetails,
        requestId: req.id
      });
      
      return res.status(400).json({
        success: false,
        error: 'Query validation failed',
        details: errorDetails
      });
    }
    
    req.query = value;
    next();
  };
};

// Common parameter schemas
const deploymentIdSchema = Joi.object({
  deploymentId: Joi.string().uuid().required()
});

const paginationSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(1000).default(100),
  offset: Joi.number().integer().min(0).default(0),
  sort: Joi.string().valid('asc', 'desc').default('desc')
});

// Export validation middlewares
module.exports = {
  // Schemas
  awsCredentialsSchema,
  repositorySchema,
  deploymentConfigSchema,
  deploymentRequestSchema,
  dockerBuildSchema,
  ecrPushRequestSchema,
  ecrRepositorySchema,
  terraformOperationSchema,
  githubRepoSchema,
  deploymentIdSchema,
  paginationSchema,

  // Middleware functions
  createValidationMiddleware,

  // Validation middleware
  validateAWSCredentials,
  validateRepository,
  validateDeploymentConfig,
  validateDeploymentRequest,
  validateDockerBuild,
  validateECRPushRequest,
  validateDeploymentECRPush,
  validateECRRepository,
  validateTerraformOperation,
  validateTerraformRequest: validateTerraformOperation, // Alias for Terraform routes
  validateGitHubRepo,
  validateGitHubRequest,
  validateDockerBuildRequest,

  // Parameter and query validation
  validateParams,
  validateQuery
};