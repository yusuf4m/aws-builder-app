const express = require('express');
const { Octokit } = require('@octokit/rest');
const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');
const tmp = require('tmp');
const { logger } = require('../utils/logger');
const { validateGitHubRequest } = require('../middleware/validation');

const router = express.Router();

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

// Validate repository URL and check accessibility
router.post('/validate-repository', validateGitHubRequest, async (req, res) => {
  try {
    const { url, accessToken } = req.body;
    
    const parsed = parseGitHubUrl(url);
    if (!parsed.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid GitHub repository URL',
        message: 'Please provide a valid GitHub repository URL'
      });
    }
    
    const octokit = new Octokit({
      auth: accessToken || undefined
    });
    
    try {
      const { data: repo } = await octokit.rest.repos.get({
        owner: parsed.owner,
        repo: parsed.repo
      });
      
      logger.info(`Repository validated: ${repo.full_name}`);
      
      res.json({
        success: true,
        repository: {
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description,
          private: repo.private,
          defaultBranch: repo.default_branch,
          language: repo.language,
          size: repo.size,
          stargazersCount: repo.stargazers_count,
          forksCount: repo.forks_count,
          openIssuesCount: repo.open_issues_count,
          createdAt: repo.created_at,
          updatedAt: repo.updated_at,
          cloneUrl: repo.clone_url,
          sshUrl: repo.ssh_url,
          htmlUrl: repo.html_url
        }
      });
    } catch (error) {
      if (error.status === 404) {
        return res.status(404).json({
          success: false,
          error: 'Repository not found',
          message: 'The repository does not exist or is not accessible'
        });
      }
      throw error;
    }
  } catch (error) {
    logger.error('Repository validation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate repository',
      message: error.message
    });
  }
});

// Get repository branches
router.post('/get-branches', validateGitHubRequest, async (req, res) => {
  try {
    const { url, accessToken } = req.body;
    
    const parsed = parseGitHubUrl(url);
    if (!parsed.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid GitHub repository URL'
      });
    }
    
    const octokit = new Octokit({
      auth: accessToken || undefined
    });
    
    const { data: branches } = await octokit.rest.repos.listBranches({
      owner: parsed.owner,
      repo: parsed.repo,
      per_page: 100
    });
    
    const branchList = branches.map(branch => ({
      name: branch.name,
      sha: branch.commit.sha,
      protected: branch.protected || false
    }));
    
    logger.info(`Retrieved ${branchList.length} branches for ${parsed.owner}/${parsed.repo}`);
    
    res.json({
      success: true,
      branches: branchList,
      defaultBranch: branches.find(b => b.name === 'main')?.name || 
                     branches.find(b => b.name === 'master')?.name || 
                     branches[0]?.name
    });
  } catch (error) {
    logger.error('Branch retrieval failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve branches',
      message: error.message
    });
  }
});

// Check for Dockerfile in repository
router.post('/check-dockerfile', validateGitHubRequest, async (req, res) => {
  try {
    const { url, branch = 'main', accessToken } = req.body;
    
    const parsed = parseGitHubUrl(url);
    if (!parsed.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid GitHub repository URL'
      });
    }
    
    const octokit = new Octokit({
      auth: accessToken || undefined
    });
    
    try {
      const { data: dockerfile } = await octokit.rest.repos.getContent({
        owner: parsed.owner,
        repo: parsed.repo,
        path: 'Dockerfile',
        ref: branch
      });
      
      const content = Buffer.from(dockerfile.content, 'base64').toString('utf-8');
      
      // Basic Dockerfile analysis
      const lines = content.split('\n');
      const fromLine = lines.find(line => line.trim().toUpperCase().startsWith('FROM'));
      const exposeLine = lines.find(line => line.trim().toUpperCase().startsWith('EXPOSE'));
      const workdirLine = lines.find(line => line.trim().toUpperCase().startsWith('WORKDIR'));
      
      res.json({
        success: true,
        dockerfile: {
          exists: true,
          size: dockerfile.size,
          sha: dockerfile.sha,
          baseImage: fromLine ? fromLine.split(' ')[1] : null,
          exposedPort: exposeLine ? exposeLine.split(' ')[1] : null,
          workdir: workdirLine ? workdirLine.split(' ')[1] : null,
          content: content.substring(0, 1000) // First 1000 chars for preview
        }
      });
    } catch (error) {
      if (error.status === 404) {
        return res.json({
          success: true,
          dockerfile: {
            exists: false,
            message: 'No Dockerfile found in repository root'
          }
        });
      }
      throw error;
    }
  } catch (error) {
    logger.error('Dockerfile check failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check for Dockerfile',
      message: error.message
    });
  }
});

// Clone repository to temporary directory
router.post('/clone-repository', validateGitHubRequest, async (req, res) => {
  try {
    const { url, branch = 'main', accessToken } = req.body;
    
    const parsed = parseGitHubUrl(url);
    if (!parsed.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid GitHub repository URL'
      });
    }
    
    // Create temporary directory
    const tmpDir = tmp.dirSync({ unsafeCleanup: true });
    const clonePath = tmpDir.name;
    
    logger.info(`Cloning repository ${url} to ${clonePath}`);
    
    const git = simpleGit();
    
    // Build clone URL with token if provided
    let cloneUrl = url;
    if (accessToken && url.startsWith('https://github.com/')) {
      cloneUrl = url.replace('https://github.com/', `https://${accessToken}@github.com/`);
    }
    
    await git.clone(cloneUrl, clonePath, ['--branch', branch, '--single-branch', '--depth', '1']);
    
    // Get repository info
    const repoGit = simpleGit(clonePath);
    const log = await repoGit.log(['-1']);
    const status = await repoGit.status();
    
    // Check if Dockerfile exists
    const dockerfilePath = path.join(clonePath, 'Dockerfile');
    let dockerfileExists = false;
    try {
      await fs.access(dockerfilePath);
      dockerfileExists = true;
    } catch (error) {
      // Dockerfile doesn't exist
    }
    
    res.json({
      success: true,
      clone: {
        path: clonePath,
        branch: status.current,
        commit: {
          hash: log.latest.hash,
          message: log.latest.message,
          author: log.latest.author_name,
          date: log.latest.date
        },
        dockerfileExists,
        cleanup: () => tmpDir.removeCallback()
      }
    });
  } catch (error) {
    logger.error('Repository cloning failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clone repository',
      message: error.message
    });
  }
});

// Get repository file tree
router.post('/get-file-tree', validateGitHubRequest, async (req, res) => {
  try {
    const { url, branch = 'main', accessToken, path: treePath = '' } = req.body;
    
    const parsed = parseGitHubUrl(url);
    if (!parsed.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid GitHub repository URL'
      });
    }
    
    const octokit = new Octokit({
      auth: accessToken || undefined
    });
    
    const { data: contents } = await octokit.rest.repos.getContent({
      owner: parsed.owner,
      repo: parsed.repo,
      path: treePath,
      ref: branch
    });
    
    const fileTree = Array.isArray(contents) ? contents.map(item => ({
      name: item.name,
      path: item.path,
      type: item.type,
      size: item.size,
      sha: item.sha,
      downloadUrl: item.download_url
    })) : [{
      name: contents.name,
      path: contents.path,
      type: contents.type,
      size: contents.size,
      sha: contents.sha,
      downloadUrl: contents.download_url
    }];
    
    res.json({
      success: true,
      fileTree,
      path: treePath
    });
  } catch (error) {
    logger.error('File tree retrieval failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve file tree',
      message: error.message
    });
  }
});

module.exports = router;