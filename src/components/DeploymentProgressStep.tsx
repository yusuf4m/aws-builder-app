'use client'

import { useState, useEffect } from 'react'
import { ArrowLeftIcon, CheckCircleIcon, ExclamationCircleIcon, ClockIcon } from '@heroicons/react/24/outline'

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
    }
    deploymentType?: 'backend' | 'frontend'
    deploymentConfig?: any
  }
}

export default function DeploymentProgressStep({ onBack, deploymentData }: DeploymentProgressStepProps) {
  const [deploymentSteps, setDeploymentSteps] = useState<DeploymentStep[]>([
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
  const [overallStatus, setOverallStatus] = useState<DeploymentStatus>('pending')

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

  const executeDeployment = async () => {
    setIsDeploying(true)
    setOverallStatus('running')
    
    try {
      const response = await fetch('http://localhost:3001/api/deployment/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          awsCredentials: deploymentData.awsCredentials,
          repository: deploymentData.repository,
          deploymentType: deploymentData.deploymentType,
          deploymentConfig: deploymentData.deploymentConfig
        }),
      })
      
      const result = await response.json()
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to start deployment')
      }
      
      const deploymentId = result.deploymentId
      
      // Set up WebSocket connection for real-time updates
      const ws = new WebSocket(`ws://localhost:3001`)
      
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join-deployment', deploymentId }))
      }
      
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data)
        
        if (data.type === 'step-update') {
          updateStepStatus(data.stepId, data.status, data.logs)
          
          if (data.status === 'running') {
            const stepIndex = deploymentSteps.findIndex(s => s.id === data.stepId)
            setCurrentStepIndex(stepIndex)
          }
        } else if (data.type === 'deployment-completed') {
          setIsDeploying(false)
          setCurrentStepIndex(deploymentSteps.length)
          setDeploymentUrl(data.deploymentUrl)
          setOverallStatus('completed')
          ws.close()
        } else if (data.type === 'deployment-failed') {
          throw new Error(data.error)
        }
      }
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        throw new Error('Connection to deployment service failed')
      }
      
    } catch (error) {
      console.error('Deployment failed:', error)
      const currentStep = deploymentSteps[currentStepIndex]
      if (currentStep) {
        updateStepStatus(currentStep.id, 'failed', ['Deployment failed: ' + (error as Error).message])
      }
      setOverallStatus('failed')
      setIsDeploying(false)
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
              <div className="mt-3 bg-gray-900 rounded text-green-400 text-xs p-3 font-mono">
                {step.logs.map((log, logIndex) => (
                  <div key={logIndex}>{log}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

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
            <button
              type="button"
              onClick={executeDeployment}
              className="btn-primary"
            >
              Retry Deployment
            </button>
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