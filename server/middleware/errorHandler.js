const { logger } = require('../utils/logger');

// Development error handler - will print stacktrace
const developmentErrorHandler = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  
  logger.error('Development error:', {
    error: {
      message: err.message,
      stack: err.stack,
      name: err.name,
      code: err.code
    },
    request: {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      requestId: req.id,
      body: req.body,
      params: req.params,
      query: req.query
    }
  });
  
  res.status(status).json({
    success: false,
    error: {
      message,
      status,
      stack: err.stack, // Include stack trace in development
      timestamp: new Date().toISOString(),
      requestId: req.id
    }
  });
};

// Production error handler - no stacktraces leaked to user
const productionErrorHandler = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  
  // Don't leak error details in production for 5xx errors
  if (status >= 500) {
    message = 'Internal Server Error';
  }
  
  logger.error('Production error:', {
    error: {
      message: err.message,
      stack: err.stack,
      name: err.name,
      code: err.code
    },
    request: {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      requestId: req.id
    }
  });
  
  res.status(status).json({
    success: false,
    error: {
      message,
      status,
      timestamp: new Date().toISOString(),
      requestId: req.id
    }
  });
};

// AWS SDK error handler
const awsErrorHandler = (err, req, res, next) => {
  if (err.name && err.name.includes('AWS')) {
    const status = err.statusCode || 500;
    let message = 'AWS service error';
    
    // Handle specific AWS errors
    switch (err.code) {
      case 'InvalidUserID.NotFound':
      case 'AccessDenied':
      case 'UnauthorizedOperation':
        message = 'AWS credentials are invalid or insufficient permissions';
        break;
      case 'ResourceNotFound':
        message = 'AWS resource not found';
        break;
      case 'ServiceUnavailable':
      case 'Throttling':
        message = 'AWS service temporarily unavailable';
        break;
      case 'ValidationException':
        message = 'Invalid AWS request parameters';
        break;
      default:
        message = err.message || 'AWS service error';
    }
    
    logger.error('AWS error:', {
      awsError: {
        code: err.code,
        message: err.message,
        statusCode: err.statusCode,
        region: err.region,
        service: err.service
      },
      request: {
        method: req.method,
        url: req.url,
        requestId: req.id
      }
    });
    
    return res.status(status).json({
      success: false,
      error: {
        message,
        code: err.code,
        service: 'AWS',
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  }
  
  next(err);
};

// Docker error handler
const dockerErrorHandler = (err, req, res, next) => {
  if (err.name === 'DockerError' || (err.message && err.message.includes('Docker'))) {
    const status = err.statusCode || 500;
    let message = 'Docker operation failed';
    
    // Handle specific Docker errors
    if (err.message.includes('No such image')) {
      message = 'Docker image not found';
    } else if (err.message.includes('permission denied')) {
      message = 'Docker permission denied';
    } else if (err.message.includes('Cannot connect to the Docker daemon')) {
      message = 'Docker daemon not running';
    } else if (err.message.includes('build failed')) {
      message = 'Docker image build failed';
    }
    
    logger.error('Docker error:', {
      dockerError: {
        message: err.message,
        statusCode: err.statusCode,
        reason: err.reason
      },
      request: {
        method: req.method,
        url: req.url,
        requestId: req.id
      }
    });
    
    return res.status(status).json({
      success: false,
      error: {
        message,
        service: 'Docker',
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  }
  
  next(err);
};

// Terraform error handler
const terraformErrorHandler = (err, req, res, next) => {
  if (err.name === 'TerraformError' || (err.message && err.message.includes('terraform'))) {
    const status = err.statusCode || 500;
    let message = 'Terraform operation failed';
    
    // Handle specific Terraform errors
    if (err.message.includes('not initialized')) {
      message = 'Terraform not initialized';
    } else if (err.message.includes('configuration is invalid')) {
      message = 'Invalid Terraform configuration';
    } else if (err.message.includes('resource already exists')) {
      message = 'Resource already exists';
    } else if (err.message.includes('insufficient permissions')) {
      message = 'Insufficient AWS permissions for Terraform';
    }
    
    logger.error('Terraform error:', {
      terraformError: {
        message: err.message,
        exitCode: err.code,
        stderr: err.stderr
      },
      request: {
        method: req.method,
        url: req.url,
        requestId: req.id
      }
    });
    
    return res.status(status).json({
      success: false,
      error: {
        message,
        service: 'Terraform',
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  }
  
  next(err);
};

// GitHub API error handler
const githubErrorHandler = (err, req, res, next) => {
  if (err.name === 'HttpError' && err.status) {
    let message = 'GitHub API error';
    
    // Handle specific GitHub errors
    switch (err.status) {
      case 401:
        message = 'Invalid GitHub access token';
        break;
      case 403:
        message = 'GitHub API rate limit exceeded or insufficient permissions';
        break;
      case 404:
        message = 'GitHub repository not found or not accessible';
        break;
      case 422:
        message = 'Invalid GitHub request parameters';
        break;
      default:
        message = err.message || 'GitHub API error';
    }
    
    logger.error('GitHub error:', {
      githubError: {
        status: err.status,
        message: err.message,
        documentation_url: err.documentation_url
      },
      request: {
        method: req.method,
        url: req.url,
        requestId: req.id
      }
    });
    
    return res.status(err.status).json({
      success: false,
      error: {
        message,
        service: 'GitHub',
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  }
  
  next(err);
};

// 404 handler
const notFoundHandler = (req, res, next) => {
  const error = new Error(`Route ${req.method} ${req.url} not found`);
  error.status = 404;
  
  logger.warn('Route not found:', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.id
  });
  
  res.status(404).json({
    success: false,
    error: {
      message: 'Route not found',
      status: 404,
      path: req.url,
      method: req.method,
      timestamp: new Date().toISOString(),
      requestId: req.id
    }
  });
};

// Main error handler - should be last middleware
const errorHandler = process.env.NODE_ENV === 'production' 
  ? productionErrorHandler 
  : developmentErrorHandler;

module.exports = {
  errorHandler,
  awsErrorHandler,
  dockerErrorHandler,
  terraformErrorHandler,
  githubErrorHandler,
  notFoundHandler,
  developmentErrorHandler,
  productionErrorHandler
};