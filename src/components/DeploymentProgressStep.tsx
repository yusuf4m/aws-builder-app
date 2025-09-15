'use client'

import { useState, useEffect, useRef } from 'react'
import { ArrowLeftIcon, CheckCircleIcon, ExclamationCircleIcon, ClockIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline'
import { io, Socket } from 'socket.io-client'

type DeploymentStatus = 'pending' | 'running' | 'completed' | 'failed'

interface DeploymentStep {
  id: string
  name: string
  description: string
  status: DeploymentStatus
  logs?: string[]
  duration?: number
}

interface DeploymentProgressStepProps {
  onBack: () => void
  deploymentData: {
    awsCredentials?: {
      accessKey: string
      secretKey: string
      region: string
    }
    repository?: {
      url: string
      branch: string
      dockerImage?: string
      owner?: string
      name?: string
      accessToken?: string
      ecrImageUri?: string
    }
    deploymentType?: 'backend' | 'frontend'
    deploymentConfig?: any
  }
}

export default function DeploymentProgressStep({ onBack, deploymentData }: DeploymentProgressStepProps) {
  const [deploymentSteps, setDeploymentSteps] = useState<DeploymentStep[]>([
    {
      id: 'clone',
      name: 'Clone Repository',
      description: deploymentData.repository?.ecrImageUri ? 'Using pre-built image (skipped)' : 'Cloning repository from GitHub',
      status: 'pending'
    },
    {
      id: 'build',
      name: 'Build Docker Image',
      description: deploymentData.repository?.ecrImageUri ? 'Using pre-built image (skipped)' : 'Building Docker image from source code',
      status: 'pending'
    },
    {
      id: 'ecr-setup',
      name: 'Setup ECR Repository',
      description: deploymentData.repository?.ecrImageUri ? 'Using existing ECR repository (skipped)' : 'Creating ECR repository for container images',
      status: 'pending'
    },
    {
      id: 'push',
      name: 'Push to ECR',
      description: deploymentData.repository?.ecrImageUri ? 'Using pre-pushed image (skipped)' : 'Pushing Docker image to ECR registry',
      status: 'pending'
    },
    {
      id: 'terraform-init',
      name: 'Initialize Terraform',
      description: 'Setting up Terraform configuration and providers',
      status: 'pending'
    },
    {
      id: 'terraform-plan',
      name: 'Plan Infrastructure',
      description: 'Creating deployment plan for AWS resources',
      status: 'pending'
    },
    {
      id: 'terraform-apply',
      name: 'Deploy Infrastructure',
      description: 'Creating EKS cluster and related resources',
      status: 'pending'
    },
    {
      id: 'kubectl-config',
      name: 'Configure kubectl',
      description: 'Setting up Kubernetes cluster access',
      status: 'pending'
    },
    {
      id: 'deploy-app',
      name: 'Deploy Application',
      description: 'Deploying your application to the EKS cluster',
      status: 'pending'
    },
    {
      id: 'verify-deployment',
      name: 'Verify Deployment',
      description: 'Checking application health and accessibility',
      status: 'pending'
    }
  ])
  
  const [currentStepIndex, setCurrentStepIndex] = useState(-1)
  const [isDeploying, setIsDeploying] = useState(false)
  const [deploymentUrl, setDeploymentUrl] = useState<string | null>(null)
  const [isDestroying, setIsDestroying] = useState(false)
  const [overallStatus, setOverallStatus] = useState<DeploymentStatus>('pending')
  const [realTimeLogs, setRealTimeLogs] = useState<Array<{timestamp: Date, message: string, level: string, stepId?: string}>>([]) 
  const [showAllLogs, setShowAllLogs] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [deploymentId, setDeploymentId] = useState<string | null>(null)
  const [socket, setSocket] = useState<Socket | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logsContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Cleanup function to disconnect socket on unmount
    return () => {
      if (socket) {
        socket.disconnect()
      }
    }
  }, [socket])
  
  // Auto-scroll effect for logs
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [realTimeLogs, autoScroll])

  const updateStepStatus = (stepId: string, status: DeploymentStatus, logs?: string[]) => {
    setDeploymentSteps(prev => prev.map(step => 
      step.id === stepId 
        ? { ...step, status, logs: logs || step.logs }
        : step
    ))
  }

  const addStepLog = (stepId: string, log: string) => {
    setDeploymentSteps(prev => prev.map(step => 
      step.id === stepId 
        ? { ...step, logs: [...(step.logs || []), log] }
        : step
    ))
  }

  const addRealTimeLog = (message: string, level: string = 'info', stepId?: string) => {
    const logEntry = {
      timestamp: new Date(),
      message,
      level,
      stepId
    }
    setRealTimeLogs(prev => [...prev, logEntry])
    
    // Auto-scroll to bottom if enabled
    if (autoScroll && logsEndRef.current) {
      setTimeout(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 100)
    }
  }

  const executeDestroy = async () => {
    if (!deploymentId) {
      alert('No deployment ID available for destroy operation')
      return
    }

    if (!confirm('Are you sure you want to destroy all AWS resources? This action cannot be undone.')) {
      return
    }

    setIsDestroying(true)
    setOverallStatus('running')
    addRealTimeLog('🗑️ Starting Terraform destroy...', 'info')

    try {
      const response = await fetch(`/api/deployment/destroy/${deploymentId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.message || 'Failed to start destroy operation')
      }

      addRealTimeLog('✅ Terraform destroy started successfully', 'success')
    } catch (error) {
      console.error('Destroy failed:', error)
      setIsDestroying(false)
      setOverallStatus('failed')
      addRealTimeLog(`❌ Failed to start destroy: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
    }
  }

  const executeDeployment = async () => {
    setIsDeploying(true)
    setOverallStatus('running')
    setRealTimeLogs([])
    
    try {
      addRealTimeLog('Starting deployment process...', 'info')
      
      const response = await fetch('http://localhost:3001/api/deployment/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          awsCredentials: {
            accessKeyId: deploymentData.awsCredentials?.accessKey,
            secretAccessKey: deploymentData.awsCredentials?.secretKey,
            region: deploymentData.awsCredentials?.region
          },
          repository: {
            ...deploymentData.repository,
            owner: deploymentData.repository?.owner || 'Corevice',
            name: deploymentData.repository?.name || 'ai-interview-back'
          },
          deploymentType: deploymentData.deploymentType === 'backend' ? 'eks' : 'fargate',
          environment: 'dev',
          deploymentConfig: {
            ...deploymentData.deploymentConfig,
            projectName: 'ai-interview-back',
            environment: 'dev',
            deploymentType: deploymentData.deploymentType === 'backend' ? 'eks' : 'fargate',
            eksConfig: {
              clusterName: 'ai-interview-cluster',
              nodeGroupName: 'ai-interview-nodes',
              instanceType: 't3.medium',
              minSize: 1,
              maxSize: 3,
              desiredSize: 2
            }
          }
        }),
      })
      
      const result = await response.json()
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to start deployment')
      }
      
      const deploymentIdValue = result.deploymentId
      setDeploymentId(deploymentIdValue)
      addRealTimeLog(`Deployment initiated with ID: ${deploymentIdValue}`, 'success')
      
      // Set up Socket.IO connection for real-time updates
      const socketConnection = io('http://localhost:3001')
      setSocket(socketConnection)
      
      socketConnection.on('connect', () => {
        socketConnection.emit('join-deployment', deploymentIdValue)
        addRealTimeLog('Connected to deployment server', 'success')
      })
      
      socketConnection.on('step-update', (data) => {
        updateStepStatus(data.stepId, data.status, data.logs)
        
        // Add step-specific logs
         if (data.logs) {
           data.logs.forEach((log: string) => {
             addRealTimeLog(log, 'info', data.stepId)
           })
         }
        
        if (data.status === 'running') {
          const stepIndex = deploymentSteps.findIndex(s => s.id === data.stepId)
          setCurrentStepIndex(stepIndex)
          addRealTimeLog(`Step ${stepIndex + 1}: ${deploymentSteps[stepIndex]?.name} - ${data.status}`, 'info', data.stepId)
        }
      })
      
      socketConnection.on('realTimeLog', (data: { message: string; level?: string; stepId?: string }) => {
        addRealTimeLog(data.message, data.level || 'info', data.stepId)
      })
      
      socketConnection.on('deployment-completed', (data) => {
        setIsDeploying(false)
        setIsDestroying(false)
        setCurrentStepIndex(deploymentSteps.length)
        setOverallStatus('completed')
        
        if (data.message && data.message.includes('destroy')) {
          addRealTimeLog('🗑️ Resources destroyed successfully!', 'success')
        } else {
          addRealTimeLog('🎉 Deployment completed successfully!', 'success')
          if (data.deploymentUrl) {
            setDeploymentUrl(data.deploymentUrl)
            addRealTimeLog(`Application URL: ${data.deploymentUrl}`, 'success')
          }
        }
        socketConnection.disconnect()
      })
      
      socketConnection.on('deployment-failed', (data) => {
        setOverallStatus('failed')
        setIsDeploying(false)
        setIsDestroying(false)
        addRealTimeLog(`❌ Deployment failed: ${data.error}`, 'error', data.stepId)
        socketConnection.disconnect()
      })
      
      socketConnection.on('connect_error', (error) => {
        console.error('Socket.IO connection error:', error)
        addRealTimeLog('⚠️ Connection error occurred', 'error')
      })
      
      socketConnection.on('disconnect', (reason) => {
        addRealTimeLog(`Connection closed: ${reason}`, 'warning')
      })
      
    } catch (error) {
      console.error('Deployment failed:', error)
      const currentStep = deploymentSteps[currentStepIndex]
      if (currentStep) {
        updateStepStatus(currentStep.id, 'failed', ['Deployment failed: ' + (error as Error).message])
      }
      setOverallStatus('failed')
      setIsDeploying(false)
      addRealTimeLog(`❌ Failed to start deployment: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
    }
  }

  const simulateDeploymentStep = async (step: DeploymentStep) => {
    const stepLogs: { [key: string]: string[] } = {
      'terraform-init': [
        'Initializing Terraform...',
        'Downloading AWS provider...',
        'Terraform initialized successfully'
      ],
      'terraform-plan': [
        'Creating execution plan...',
        'Planning EKS cluster creation...',
        'Plan created successfully'
      ],
      'terraform-apply': [
        'Creating VPC and subnets...',
        'Setting up security groups...',
        'Creating EKS cluster...',
        'Configuring node groups...',
        'Infrastructure deployed successfully'
      ],
      'kubectl-config': [
        'Updating kubeconfig...',
        'Testing cluster connectivity...',
        'kubectl configured successfully'
      ],
      'deploy-app': [
        'Creating Kubernetes manifests...',
        'Applying deployment configuration...',
        'Creating services and ingress...',
        'Application deployed successfully'
      ],
      'verify-deployment': [
        'Checking pod status...',
        'Verifying service endpoints...',
        'Testing application health...',
        'Deployment verified successfully'
      ]
    }

    const logs = stepLogs[step.id] || ['Processing...']
    
    for (const log of logs) {
      addStepLog(step.id, log)
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000))
    }
  }

  const getStatusIcon = (status: DeploymentStatus) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon className="h-5 w-5 text-success-600" />
      case 'failed':
        return <ExclamationCircleIcon className="h-5 w-5 text-error-600" />
      case 'running':
        return (
          <svg className="animate-spin h-5 w-5 text-primary-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        )
      default:
        return <ClockIcon className="h-5 w-5 text-gray-400" />
    }
  }

  const getStatusColor = (status: DeploymentStatus) => {
    switch (status) {
      case 'completed': return 'text-success-600'
      case 'failed': return 'text-error-600'
      case 'running': return 'text-primary-600'
      default: return 'text-gray-500'
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Deployment Progress</h2>
        <p className="text-gray-600">
          Deploying your {deploymentData.deploymentType} application to AWS EKS.
        </p>
      </div>

      {/* Deployment Summary */}
      <div className="bg-gray-50 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-medium text-gray-900 mb-2">Deployment Summary</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Repository:</span>
            <span className="ml-2 font-medium">{deploymentData.repository?.url}</span>
          </div>
          <div>
            <span className="text-gray-500">Branch:</span>
            <span className="ml-2 font-medium">{deploymentData.repository?.branch}</span>
          </div>
          <div>
            <span className="text-gray-500">Type:</span>
            <span className="ml-2 font-medium capitalize">{deploymentData.deploymentType}</span>
          </div>
          <div>
            <span className="text-gray-500">Region:</span>
            <span className="ml-2 font-medium">{deploymentData.awsCredentials?.region}</span>
          </div>
        </div>
      </div>

      {/* Deployment Steps */}
      <div className="space-y-4 mb-6">
        {deploymentSteps.map((step, index) => (
          <div key={step.id} className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                {getStatusIcon(step.status)}
                <div className="ml-3">
                  <h4 className={`text-sm font-medium ${getStatusColor(step.status)}`}>
                    {step.name}
                  </h4>
                  <p className="text-xs text-gray-500">{step.description}</p>
                </div>
              </div>
              <span className={`text-xs font-medium ${getStatusColor(step.status)}`}>
                {step.status.charAt(0).toUpperCase() + step.status.slice(1)}
              </span>
            </div>
            
            {step.logs && step.logs.length > 0 && (
              <div className="mt-3 bg-gray-50 rounded-lg p-3">
                <div className="text-sm font-medium text-gray-700 mb-2">Step Logs:</div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {step.logs.map((log, logIndex) => (
                    <div key={logIndex} className="text-sm text-gray-600 font-mono break-words">
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Real-time Logs Section */}
      {(isDeploying || realTimeLogs.length > 0) && (
        <div className="mt-8 bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Deployment Logs</h3>
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => setShowAllLogs(!showAllLogs)}
                  className="inline-flex items-center px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                >
                  {showAllLogs ? (
                    <><EyeSlashIcon className="h-4 w-4 mr-1" /> Hide Details</>
                  ) : (
                    <><EyeIcon className="h-4 w-4 mr-1" /> Show All</>
                  )}
                </button>
                <button
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={`inline-flex items-center px-3 py-1 text-sm rounded-md transition-colors ${
                    autoScroll 
                      ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Auto-scroll: {autoScroll ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={() => setRealTimeLogs([])}
                  className="inline-flex items-center px-3 py-1 text-sm bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors"
                  disabled={isDeploying}
                >
                  Clear Logs
                </button>
              </div>
            </div>
          </div>
          
          <div 
            ref={logsContainerRef}
            className="px-6 py-4 bg-gray-900 text-green-400 font-mono text-sm max-h-96 overflow-y-auto"
          >
            {realTimeLogs.length === 0 ? (
              <div className="text-gray-500 italic">No logs yet...</div>
            ) : (
              <div className="space-y-1">
                {realTimeLogs
                  .filter(log => showAllLogs || !log.stepId || log.level === 'error' || log.level === 'success')
                  .map((log, index) => {
                    const levelColors = {
                      error: 'text-red-400',
                      warning: 'text-yellow-400', 
                      success: 'text-green-400',
                      info: 'text-blue-400'
                    }
                    const colorClass = levelColors[log.level as keyof typeof levelColors] || 'text-gray-300'
                    
                    return (
                      <div key={index} className="flex items-start space-x-2">
                        <span className="text-gray-500 text-xs shrink-0 mt-0.5">
                          {log.timestamp.toLocaleTimeString()}
                        </span>
                        <span className={`${colorClass} break-words flex-1`}>
                          {log.message}
                        </span>
                      </div>
                    )
                  })
                }
                <div ref={logsEndRef} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Success Message */}
      {overallStatus === 'completed' && deploymentUrl && (
        <div className="bg-success-50 border border-success-200 rounded-lg p-4 mb-6">
          <div className="flex items-center">
            <CheckCircleIcon className="h-5 w-5 text-success-600" />
            <h3 className="ml-2 text-sm font-medium text-success-800">
              Deployment Successful!
            </h3>
          </div>
          <p className="mt-2 text-sm text-success-700">
            Your application is now running at:
          </p>
          <a
            href={deploymentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 text-sm font-medium text-success-600 hover:text-success-500 underline"
          >
            {deploymentUrl}
          </a>
        </div>
      )}

      {/* Error Message */}
      {overallStatus === 'failed' && (
        <div className="bg-error-50 border border-error-200 rounded-lg p-4 mb-6">
          <div className="flex items-center">
            <ExclamationCircleIcon className="h-5 w-5 text-error-600" />
            <h3 className="ml-2 text-sm font-medium text-error-800">
              Deployment Failed
            </h3>
          </div>
          <p className="mt-2 text-sm text-error-700">
            Please check the logs above and try again.
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-between pt-6">
        <button
          type="button"
          onClick={onBack}
          className="btn-secondary flex items-center"
          disabled={isDeploying}
        >
          <ArrowLeftIcon className="h-4 w-4 mr-2" />
          Back
        </button>
        
        <div className="space-x-3">
          {overallStatus === 'pending' && (
            <button
              type="button"
              onClick={executeDeployment}
              className="btn-primary"
              disabled={isDeploying}
            >
              {isDeploying ? 'Deploying...' : 'Start Deployment'}
            </button>
          )}
          
          {overallStatus === 'failed' && (
            <>
              <button
                type="button"
                onClick={executeDestroy}
                className="btn-secondary bg-red-600 hover:bg-red-700 text-white border-red-600 hover:border-red-700"
                disabled={isDestroying}
              >
                {isDestroying ? 'Destroying...' : '🗑️ Destroy Resources'}
              </button>
              <button
                type="button"
                onClick={executeDeployment}
                className="btn-primary"
                disabled={isDestroying}
              >
                Retry Deployment
              </button>
            </>
          )}
          
          {overallStatus === 'completed' && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn-primary"
            >
              New Deployment
            </button>
          )}
        </div>
      </div>
    </div>
  )
}