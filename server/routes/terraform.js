const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const tmp = require('tmp');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');
const { validateTerraformRequest } = require('../middleware/validation');

const router = express.Router();

// Store active deployments
const activeDeployments = new Map();

// Terraform template path
const TERRAFORM_TEMPLATE_PATH = '/Users/yusufam/Desktop/Corevice/aws-builder-eks';

// Generate Terraform variables file
function generateTerraformVars(deploymentConfig) {
  const {
    projectName,
    environment,
    awsRegion,
    deploymentType,
    repositoryUrl,
    dockerImage,
    replicas = 2,
    port = 80,
    environmentVariables = {},
    resourceLimits = {}
  } = deploymentConfig;

  const tfVars = {
    // Core configuration
    project_name: projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    environment: environment,
    aws_region: awsRegion,

    // Networking
    vpc_cidr: environment === 'prod' ? '10.0.0.0/16' : '10.1.0.0/16',
    availability_zones_count: environment === 'prod' ? 3 : 2,
    enable_nat_gateway: true,
    single_nat_gateway: environment !== 'prod',

    // EKS Configuration
    kubernetes_version: '1.28',
    endpoint_private_access: true,
    endpoint_public_access: true,
    node_group_instance_types: environment === 'prod' ? ['t3.medium', 't3.large'] : ['t3.small', 't3.medium'],
    node_group_capacity_type: environment === 'prod' ? 'ON_DEMAND' : 'SPOT',
    node_group_min_size: environment === 'prod' ? 2 : 1,
    node_group_max_size: environment === 'prod' ? 10 : 5,
    node_group_desired_size: environment === 'prod' ? 3 : 2,

    // Application Configuration
    application_name: `${projectName}-${deploymentType}`,
    application_image: dockerImage,
    application_port: port,
    application_replicas: replicas,
    application_env_vars: environmentVariables,

    // Resource limits
    cpu_request: resourceLimits.cpuRequest || (environment === 'prod' ? '500m' : '250m'),
    cpu_limit: resourceLimits.cpuLimit || (environment === 'prod' ? '1000m' : '500m'),
    memory_request: resourceLimits.memoryRequest || (environment === 'prod' ? '512Mi' : '256Mi'),
    memory_limit: resourceLimits.memoryLimit || (environment === 'prod' ? '1Gi' : '512Mi'),

    // Security
    allowed_cidr_blocks: environment === 'prod' ? ['10.0.0.0/8'] : ['0.0.0.0/0'],
    enable_deletion_protection: environment === 'prod',

    // Monitoring
    enable_monitoring: true,
    enable_logging: true,
    log_retention_days: environment === 'prod' ? 30 : 7,

    // Database (if backend deployment)
    enable_database: deploymentType === 'backend',
    db_instance_class: environment === 'prod' ? 'db.t3.medium' : 'db.t3.micro',
    db_allocated_storage: environment === 'prod' ? 100 : 20,
    db_backup_retention_period: environment === 'prod' ? 7 : 1,

    // Load Balancer
    enable_ssl: true,
    ssl_policy: 'ELBSecurityPolicy-TLS-1-2-2017-01',
    idle_timeout: 60,
    enable_cross_zone_load_balancing: true
  };

  return tfVars;
}

// Convert object to Terraform variables format
function objectToTfVars(obj) {
  let content = '';
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      content += `${key} = "${value}"\n`;
    } else if (typeof value === 'number') {
      content += `${key} = ${value}\n`;
    } else if (typeof value === 'boolean') {
      content += `${key} = ${value}\n`;
    } else if (Array.isArray(value)) {
      content += `${key} = [${value.map(v => `"${v}"`).join(', ')}]\n`;
    } else if (typeof value === 'object' && value !== null) {
      content += `${key} = {\n`;
      for (const [subKey, subValue] of Object.entries(value)) {
        content += `  ${subKey} = "${subValue}"\n`;
      }
      content += `}\n`;
    }
  }
  return content;
}

// Execute Terraform command
function executeTerraform(command, args, workingDir, deploymentId, io) {
  return new Promise((resolve, reject) => {
    const process = spawn('terraform', [command, ...args], {
      cwd: workingDir,
      env: { ...process.env, TF_IN_AUTOMATION: 'true' }
    });

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      
      // Emit real-time output to WebSocket
      io.to(`deployment-${deploymentId}`).emit('terraform-output', {
        type: 'stdout',
        data: output,
        command: command
      });
      
      logger.info(`Terraform ${command} stdout:`, output.trim());
    });

    process.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      
      // Emit real-time output to WebSocket
      io.to(`deployment-${deploymentId}`).emit('terraform-output', {
        type: 'stderr',
        data: output,
        command: command
      });
      
      logger.warn(`Terraform ${command} stderr:`, output.trim());
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, exitCode: code });
      } else {
        reject(new Error(`Terraform ${command} failed with exit code ${code}\n${stderr}`));
      }
    });

    process.on('error', (error) => {
      reject(new Error(`Failed to start terraform ${command}: ${error.message}`));
    });

    // Store process reference for potential cancellation
    if (activeDeployments.has(deploymentId)) {
      activeDeployments.get(deploymentId).processes.push(process);
    }
  });
}

// Initialize Terraform deployment
router.post('/init', validateTerraformRequest, async (req, res) => {
  try {
    const deploymentId = uuidv4();
    const { deploymentConfig, awsCredentials } = req.body;
    
    // Create temporary working directory
    const tmpDir = tmp.dirSync({ unsafeCleanup: true });
    const workingDir = tmpDir.name;
    
    logger.info(`Initializing Terraform deployment ${deploymentId} in ${workingDir}`);
    
    // Copy Terraform template to working directory
    await fs.cp(TERRAFORM_TEMPLATE_PATH, workingDir, { recursive: true });
    
    // Generate terraform.tfvars file
    const tfVars = generateTerraformVars(deploymentConfig);
    const tfVarsContent = objectToTfVars(tfVars);
    await fs.writeFile(path.join(workingDir, 'terraform.tfvars'), tfVarsContent);
    
    // Generate backend configuration
    const backendConfig = {
      bucket: `${deploymentConfig.projectName}-${deploymentConfig.environment}-terraform-state`,
      key: `${deploymentConfig.projectName}/${deploymentConfig.environment}/terraform.tfstate`,
      region: awsCredentials.region,
      encrypt: true,
      dynamodb_table: `${deploymentConfig.projectName}-${deploymentConfig.environment}-terraform-locks`
    };
    
    const backendContent = objectToTfVars(backendConfig);
    await fs.writeFile(path.join(workingDir, 'backend.hcl'), backendContent);
    
    // Store deployment info
    activeDeployments.set(deploymentId, {
      id: deploymentId,
      workingDir,
      deploymentConfig,
      awsCredentials,
      status: 'initialized',
      startTime: new Date(),
      processes: [],
      cleanup: tmpDir.removeCallback
    });
    
    res.json({
      success: true,
      deploymentId,
      workingDir,
      tfVars,
      backendConfig
    });
  } catch (error) {
    logger.error('Terraform initialization failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize Terraform',
      message: error.message
    });
  }
});

// Run Terraform init
router.post('/terraform-init/:deploymentId', async (req, res) => {
  try {
    const { deploymentId } = req.params;
    const deployment = activeDeployments.get(deploymentId);
    
    if (!deployment) {
      return res.status(404).json({
        success: false,
        error: 'Deployment not found'
      });
    }
    
    logger.info(`Running terraform init for deployment ${deploymentId}`);
    
    // Set AWS credentials as environment variables
    process.env.AWS_ACCESS_KEY_ID = deployment.awsCredentials.accessKey;
    process.env.AWS_SECRET_ACCESS_KEY = deployment.awsCredentials.secretKey;
    process.env.AWS_DEFAULT_REGION = deployment.awsCredentials.region;
    
    const result = await executeTerraform(
      'init',
      ['-backend-config=backend.hcl'],
      deployment.workingDir,
      deploymentId,
      req.io
    );
    
    deployment.status = 'init-complete';
    
    res.json({
      success: true,
      deploymentId,
      output: result.stdout,
      status: deployment.status
    });
  } catch (error) {
    logger.error('Terraform init failed:', error);
    res.status(500).json({
      success: false,
      error: 'Terraform init failed',
      message: error.message
    });
  }
});

// Run Terraform plan
router.post('/terraform-plan/:deploymentId', async (req, res) => {
  try {
    const { deploymentId } = req.params;
    const deployment = activeDeployments.get(deploymentId);
    
    if (!deployment) {
      return res.status(404).json({
        success: false,
        error: 'Deployment not found'
      });
    }
    
    logger.info(`Running terraform plan for deployment ${deploymentId}`);
    
    const result = await executeTerraform(
      'plan',
      ['-out=tfplan'],
      deployment.workingDir,
      deploymentId,
      req.io
    );
    
    deployment.status = 'plan-complete';
    
    res.json({
      success: true,
      deploymentId,
      output: result.stdout,
      status: deployment.status
    });
  } catch (error) {
    logger.error('Terraform plan failed:', error);
    res.status(500).json({
      success: false,
      error: 'Terraform plan failed',
      message: error.message
    });
  }
});

// Run Terraform apply
router.post('/terraform-apply/:deploymentId', async (req, res) => {
  try {
    const { deploymentId } = req.params;
    const deployment = activeDeployments.get(deploymentId);
    
    if (!deployment) {
      return res.status(404).json({
        success: false,
        error: 'Deployment not found'
      });
    }
    
    logger.info(`Running terraform apply for deployment ${deploymentId}`);
    
    const result = await executeTerraform(
      'apply',
      ['-auto-approve', 'tfplan'],
      deployment.workingDir,
      deploymentId,
      req.io
    );
    
    deployment.status = 'apply-complete';
    
    // Parse outputs from terraform apply
    try {
      const outputResult = await executeTerraform(
        'output',
        ['-json'],
        deployment.workingDir,
        deploymentId,
        req.io
      );
      
      const outputs = JSON.parse(outputResult.stdout);
      deployment.outputs = outputs;
    } catch (outputError) {
      logger.warn('Failed to parse terraform outputs:', outputError);
    }
    
    res.json({
      success: true,
      deploymentId,
      output: result.stdout,
      outputs: deployment.outputs,
      status: deployment.status
    });
  } catch (error) {
    logger.error('Terraform apply failed:', error);
    deployment.status = 'apply-failed';
    res.status(500).json({
      success: false,
      error: 'Terraform apply failed',
      message: error.message
    });
  }
});

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
      status: deployment.status,
      startTime: deployment.startTime,
      outputs: deployment.outputs,
      config: deployment.deploymentConfig
    }
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
  
  // Kill all running processes
  deployment.processes.forEach(process => {
    if (!process.killed) {
      process.kill('SIGTERM');
    }
  });
  
  deployment.status = 'cancelled';
  
  logger.info(`Deployment ${deploymentId} cancelled`);
  
  res.json({
    success: true,
    deploymentId,
    status: deployment.status
  });
});

// Cleanup deployment
router.delete('/cleanup/:deploymentId', (req, res) => {
  const { deploymentId } = req.params;
  const deployment = activeDeployments.get(deploymentId);
  
  if (!deployment) {
    return res.status(404).json({
      success: false,
      error: 'Deployment not found'
    });
  }
  
  // Kill processes and cleanup
  deployment.processes.forEach(process => {
    if (!process.killed) {
      process.kill('SIGTERM');
    }
  });
  
  deployment.cleanup();
  activeDeployments.delete(deploymentId);
  
  logger.info(`Deployment ${deploymentId} cleaned up`);
  
  res.json({
    success: true,
    deploymentId,
    message: 'Deployment cleaned up successfully'
  });
});

module.exports = router;