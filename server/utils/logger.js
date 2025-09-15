const winston = require('winston');
const path = require('path');

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'aws-builder-api' },
  transports: [
    // Write all logs with level 'error' and below to error.log
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      tailable: true
    }),
    
    // Write all logs with level 'info' and below to combined.log
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      tailable: true
    }),
    
    // Write deployment-specific logs
    new winston.transports.File({
      filename: path.join(logsDir, 'deployment.log'),
      level: 'info',
      maxsize: 10485760, // 10MB
      maxFiles: 10,
      tailable: true,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, deploymentId, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta, (key, value) => {
            if (typeof value === 'object' && value !== null) {
              if (value.constructor && (value.constructor.name === 'ClientRequest' || value.constructor.name === 'IncomingMessage')) {
                return '[Circular]';
              }
            }
            return value;
          }) : '';
          const deploymentStr = deploymentId ? `[${deploymentId}]` : '';
          return `${timestamp} [${level.toUpperCase()}] ${deploymentStr} ${message} ${metaStr}`;
        })
      )
    })
  ]
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({
        format: 'HH:mm:ss'
      }),
      winston.format.printf(({ timestamp, level, message, deploymentId, ...meta }) => {
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta, (key, value) => {
          if (typeof value === 'object' && value !== null) {
            if (value.constructor && (value.constructor.name === 'ClientRequest' || value.constructor.name === 'IncomingMessage')) {
              return '[Circular]';
            }
          }
          return value;
        }) : '';
        const deploymentStr = deploymentId ? `[${deploymentId}]` : '';
        return `${timestamp} ${level} ${deploymentStr} ${message} ${metaStr}`;
      })
    )
  }));
}

// Create deployment-specific logger
const createDeploymentLogger = (deploymentId) => {
  return {
    info: (message, meta = {}) => logger.info(message, { deploymentId, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { deploymentId, ...meta }),
    error: (message, meta = {}) => logger.error(message, { deploymentId, ...meta }),
    debug: (message, meta = {}) => logger.debug(message, { deploymentId, ...meta })
  };
};

// Request logging middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  const { method, url, ip } = req;
  const userAgent = req.get('User-Agent') || '';
  
  // Log request start
  logger.info('Request started', {
    method,
    url,
    ip,
    userAgent,
    requestId: req.id
  });
  
  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - start;
    const { statusCode } = res;
    const contentLength = res.get('Content-Length') || 0;
    
    logger.info('Request completed', {
      method,
      url,
      ip,
      statusCode,
      duration,
      contentLength,
      requestId: req.id
    });
    
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
};

// Error logging middleware
const errorLogger = (err, req, res, next) => {
  const { method, url, ip } = req;
  const userAgent = req.get('User-Agent') || '';
  
  logger.error('Request error', {
    error: {
      message: err.message,
      stack: err.stack,
      name: err.name
    },
    request: {
      method,
      url,
      ip,
      userAgent,
      requestId: req.id,
      body: req.body,
      params: req.params,
      query: req.query
    }
  });
  
  next(err);
};

// AWS operation logger
const awsLogger = {
  logOperation: (operation, params, result, error = null) => {
    const logData = {
      operation,
      params: {
        ...params,
        // Remove sensitive data
        accessKeyId: params.accessKeyId ? '***' : undefined,
        secretAccessKey: params.secretAccessKey ? '***' : undefined,
        sessionToken: params.sessionToken ? '***' : undefined
      },
      success: !error,
      timestamp: new Date().toISOString()
    };
    
    if (error) {
      logData.error = {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode
      };
      logger.error(`AWS operation failed: ${operation}`, logData);
    } else {
      logData.result = result;
      logger.info(`AWS operation successful: ${operation}`, logData);
    }
  }
};

// Terraform operation logger
const terraformLogger = {
  logCommand: (command, workingDir, output, error = null) => {
    const logData = {
      command,
      workingDir,
      success: !error,
      timestamp: new Date().toISOString()
    };
    
    if (error) {
      logData.error = {
        message: error.message,
        code: error.code,
        stderr: error.stderr
      };
      logger.error(`Terraform command failed: ${command}`, logData);
    } else {
      logData.output = output;
      logger.info(`Terraform command successful: ${command}`, logData);
    }
  }
};

// Docker operation logger
const dockerLogger = {
  logOperation: (operation, params, result, error = null) => {
    const logData = {
      operation,
      params,
      success: !error,
      timestamp: new Date().toISOString()
    };
    
    if (error) {
      logData.error = {
        message: error.message,
        statusCode: error.statusCode
      };
      logger.error(`Docker operation failed: ${operation}`, logData);
    } else {
      logData.result = result;
      logger.info(`Docker operation successful: ${operation}`, logData);
    }
  }
};

module.exports = {
  logger,
  createDeploymentLogger,
  requestLogger,
  errorLogger,
  awsLogger,
  terraformLogger,
  dockerLogger
};