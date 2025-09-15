const express = require('express');
const Docker = require('dockerode');
const simpleGit = require('simple-git');
const tar = require('tar');
const fs = require('fs').promises;
const path = require('path');
const tmp = require('tmp');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');
const { validateDockerBuild, validateDockerBuildRequest } = require('../middleware/validation');

const router = express.Router();
const docker = new Docker();

// Store active builds
const activeBuilds = new Map();

// Parse GitHub repository URL
function parseGitHubUrl(url) {
  const patterns = [
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
    /^git@github\.com:([^/]+)\/([^/]+?)\.git$/,
    /^https:\/\/www\.github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return {
        owner: match[1],
        repo: match[2],
        isValid: true
      };
    }
  }
  
  return { isValid: false };
}

// Build Docker image from GitHub repository
router.post('/build', validateDockerBuildRequest, async (req, res) => {
  try {
    const { url, branch = 'main', accessToken, imageName: customImageName, imageTag: customImageTag } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Repository URL is required'
      });
    }
    
    const repositoryUrl = url;
    
    const parsed = parseGitHubUrl(repositoryUrl);
    if (!parsed.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid GitHub repository URL'
      });
    }
    
    const buildId = uuidv4();
    // Use custom image name if provided, otherwise generate from repo info
    const imageName = customImageName || `${parsed.owner}-${parsed.repo}`.toLowerCase();
    const imageTag = customImageTag || 'latest';
    const fullImageName = `${imageName}:${imageTag}`;
    

    
    logger.info(`Starting Docker build for ${repositoryUrl} (${branch})`);
    
    // Store build info
    activeBuilds.set(buildId, {
      id: buildId,
      status: 'cloning',
      repositoryUrl,
      branch,
      imageName: fullImageName,
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
        buildId
      };
      activeBuilds.get(buildId).logs.push(logEntry);
      io.emit('docker-build-log', logEntry);
    };
    
    emitLog(`Starting Docker build for ${repositoryUrl} (${branch})`, 'info');
    
    // Create temporary directory
    const tmpDir = tmp.dirSync({ unsafeCleanup: true });
    const clonePath = tmpDir.name;
    
    try {
      // Clone repository
      logger.info(`Cloning repository to ${clonePath}`);
      const git = simpleGit();
      
      // Construct clone URL with access token if provided
      let cloneUrl = repositoryUrl;
      if (accessToken) {
        // Convert HTTPS URL to include token
        cloneUrl = repositoryUrl.replace('https://github.com/', `https://${accessToken}@github.com/`);
      }
      
      await git.clone(cloneUrl, clonePath, ['--branch', branch, '--single-branch', '--depth', '1']);
      
      // Update build status
      activeBuilds.get(buildId).status = 'building';
      emitLog(`Repository cloned successfully from ${repositoryUrl}`, 'info');
      
      // Check if Dockerfile exists
      const dockerfilePath = path.join(clonePath, 'Dockerfile');
      try {
        await fs.access(dockerfilePath);
      } catch (error) {
        throw new Error('No Dockerfile found in repository root');
      }
      
      // Create tar stream from repository directory
      const tarStream = tar.create(
        {
          gzip: true,
          cwd: clonePath
        },
        ['.'] // Include all files
      );
      
      // Build image
      const buildOptions = {
        t: fullImageName,
        dockerfile: 'Dockerfile',
        rm: true, // Remove intermediate containers
        forcerm: true, // Always remove intermediate containers
        pull: true // Always pull base image
      };
      const buildStream = await docker.buildImage(tarStream, buildOptions);
      
      // Handle build stream
      const buildPromise = new Promise((resolve, reject) => {
        const buildLogs = [];
        
        docker.modem.followProgress(buildStream, (err, result) => {
          if (err) {
            logger.error('Docker build failed:', err);
            activeBuilds.get(buildId).status = 'failed';
            activeBuilds.get(buildId).error = err.message;
            reject(err);
          } else {
            logger.info('Docker build completed successfully');
            activeBuilds.get(buildId).status = 'completed';
            activeBuilds.get(buildId).completedAt = new Date();
            activeBuilds.get(buildId).logs = [...activeBuilds.get(buildId).logs, ...buildLogs];
            resolve(result);
          }
        }, (event) => {
          // Handle build progress
          if (event.stream) {
            const logEntry = {
              timestamp: new Date(),
              message: event.stream.trim(),
              level: 'info'
            };
            buildLogs.push(logEntry);
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
      
      // Check if our image exists, if not try to find the most recent dangling image
      let targetImage;
      try {
        targetImage = docker.getImage(fullImageName);
        await targetImage.inspect();
      } catch (error) {
        // Find the most recent dangling image (likely our build result)
        const images = await docker.listImages();
        const danglingImages = images.filter(img => 
          !img.RepoTags || img.RepoTags.length === 0 || img.RepoTags[0] === '<none>:<none>'
        ).sort((a, b) => b.Created - a.Created);
        
        if (danglingImages.length > 0) {
          const mostRecentDangling = danglingImages[0];
          
          // Tag the dangling image with our desired name
          const danglingImage = docker.getImage(mostRecentDangling.Id);
          await danglingImage.tag({ repo: imageName, tag: imageTag });
          
          targetImage = docker.getImage(fullImageName);
        } else {
          throw new Error(`No image found with name ${fullImageName} and no dangling images available`);
        }
      }
      
      // Get image info
      const imageInfo = await targetImage.inspect();
      
      // Cleanup temporary directory
      tmpDir.removeCallback();
      
      res.json({
        success: true,
        buildId,
        image: {
          id: imageInfo.Id,
          name: fullImageName,
          size: imageInfo.Size,
          created: imageInfo.Created,
          architecture: imageInfo.Architecture,
          os: imageInfo.Os
        },
        repository: {
          url: repositoryUrl,
          branch,
          owner: parsed.owner,
          repo: parsed.repo
        },
        status: 'completed'
      });
    } catch (error) {
      // Cleanup temporary directory
      tmpDir.removeCallback();
      throw error;
    }
  } catch (error) {
    logger.error('Docker build failed:', error);
    
    const buildId = req.body.buildId;
    if (buildId && activeBuilds.has(buildId)) {
      activeBuilds.get(buildId).status = 'failed';
      activeBuilds.get(buildId).error = error.message;
    }
    
    res.status(500).json({
      success: false,
      error: 'Docker build failed',
      message: error.message
    });
  }
});

// Get build status
router.get('/build-status/:buildId', (req, res) => {
  const { buildId } = req.params;
  const build = activeBuilds.get(buildId);
  
  if (!build) {
    return res.status(404).json({
      success: false,
      error: 'Build not found'
    });
  }
  
  res.json({
    success: true,
    build: {
      id: build.id,
      status: build.status,
      repositoryUrl: build.repositoryUrl,
      branch: build.branch,
      imageName: build.imageName,
      startTime: build.startTime,
      completedAt: build.completedAt,
      error: build.error,
      logs: build.logs.slice(-20) // Last 20 logs
    }
  });
});

// Get build logs
router.get('/build-logs/:buildId', (req, res) => {
  const { buildId } = req.params;
  const build = activeBuilds.get(buildId);
  
  if (!build) {
    return res.status(404).json({
      success: false,
      error: 'Build not found'
    });
  }
  
  const { limit = 100, offset = 0 } = req.query;
  const logs = build.logs.slice(offset, offset + parseInt(limit));
  
  res.json({
    success: true,
    buildId,
    logs,
    total: build.logs.length
  });
});

// List Docker images
router.get('/images', async (req, res) => {
  try {
    const images = await docker.listImages();
    
    const imageList = images.map(image => ({
      id: image.Id,
      tags: image.RepoTags || [],
      size: image.Size,
      created: image.Created,
      labels: image.Labels || {}
    }));
    
    res.json({
      success: true,
      images: imageList
    });
  } catch (error) {
    logger.error('Failed to list Docker images:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list Docker images',
      message: error.message
    });
  }
});

// Remove Docker image
router.delete('/images/:imageId', async (req, res) => {
  try {
    const { imageId } = req.params;
    const { force = false } = req.query;
    
    const image = docker.getImage(imageId);
    await image.remove({ force: force === 'true' });
    
    logger.info(`Docker image ${imageId} removed`);
    
    res.json({
      success: true,
      message: `Image ${imageId} removed successfully`
    });
  } catch (error) {
    logger.error('Failed to remove Docker image:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove Docker image',
      message: error.message
    });
  }
});

module.exports = router;