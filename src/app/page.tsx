'use client'

import { useState } from 'react'
import { ChevronRightIcon, CheckIcon } from '@heroicons/react/24/outline'
import AWSCredentialsStep from '../components/AWSCredentialsStep'
import RepositoryStep from '../components/RepositoryStep'
import DeploymentTypeStep from '../components/DeploymentTypeStep'
import DeploymentConfigStep, { TerraformConfig } from '../components/DeploymentConfigStep'
import DeploymentProgressStep from '../components/DeploymentProgressStep'

type Step = {
  id: number
  name: string
  description: string
  status: 'pending' | 'current' | 'completed'
}

type DeploymentData = {
  awsCredentials?: {
    accessKey: string
    secretKey: string
    region: string
  }
  repository?: {
    url: string
    branch: string
    dockerImage?: string
    name?: string
  }
  deploymentType?: 'backend' | 'frontend'
  environment?: 'dev' | 'staging' | 'prod'
  deploymentConfig?: any
  terraformConfig?: TerraformConfig
}

// Helper function to extract repository name from URL
const extractRepoName = (url: string): string => {
  if (!url) return ''
  const match = url.match(/\/([^/]+?)(\.git)?$/)
  return match ? match[1] : ''
}

export default function Home() {
  const [currentStep, setCurrentStep] = useState(1)
  const [deploymentData, setDeploymentData] = useState<DeploymentData>({})

  const steps: Step[] = [
    {
      id: 1,
      name: 'AWS Credentials',
      description: 'Configure AWS access credentials and region',
      status: currentStep === 1 ? 'current' : currentStep > 1 ? 'completed' : 'pending'
    },
    {
      id: 2,
      name: 'Repository',
      description: 'Select repository and branch for deployment',
      status: currentStep === 2 ? 'current' : currentStep > 2 ? 'completed' : 'pending'
    },
    {
      id: 3,
      name: 'Deployment Type',
      description: 'Choose backend or frontend deployment configuration',
      status: currentStep === 3 ? 'current' : currentStep > 3 ? 'completed' : 'pending'
    },
    {
      id: 4,
      name: 'Infrastructure Config',
      description: 'Configure VPC, EKS, database, SSL, and monitoring settings',
      status: currentStep === 4 ? 'current' : currentStep > 4 ? 'completed' : 'pending'
    },
    {
      id: 5,
      name: 'Deploy',
      description: 'Execute deployment and monitor progress',
      status: currentStep === 5 ? 'current' : currentStep > 5 ? 'completed' : 'pending'
    }
  ]

  const handleStepComplete = (stepData: any) => {
    setDeploymentData(prev => ({ ...prev, ...stepData }))
    setCurrentStep(prev => prev + 1)
  }

  const handleStepBack = () => {
    setCurrentStep(prev => Math.max(1, prev - 1))
  }

  const handleTerminateDeployment = () => {
    // Reset to the infrastructure config step to allow user to reconfigure
    setCurrentStep(4)
    // Optionally clear deployment data to force reconfiguration
    setDeploymentData(prev => ({
      ...prev,
      deploymentConfig: undefined,
      terraformConfig: undefined
    }))
  }

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <AWSCredentialsStep
            onComplete={handleStepComplete}
            initialData={deploymentData.awsCredentials}
          />
        )
      case 2:
        return (
          <RepositoryStep
            onComplete={handleStepComplete}
            onBack={handleStepBack}
            initialData={deploymentData.repository}
            awsCredentials={deploymentData.awsCredentials}
          />
        )
      case 3:
        return (
          <DeploymentTypeStep
            onComplete={handleStepComplete}
            onBack={handleStepBack}
            initialData={{
              deploymentType: deploymentData.deploymentType || 'backend',
              environment: deploymentData.environment || 'dev'
            }}
            repository={deploymentData.repository}
          />
        )
      case 4:
        return (
          <DeploymentConfigStep
            onComplete={(terraformConfig) => handleStepComplete({ terraformConfig })}
            onBack={handleStepBack}
            environment={deploymentData.environment || 'dev'}
            repository={{
              url: deploymentData.repository?.url || '',
              branch: deploymentData.repository?.branch || 'main',
              name: deploymentData.repository?.name || extractRepoName(deploymentData.repository?.url || '')
            }}
            initialConfig={deploymentData.terraformConfig}
          />
        )
      case 5:
        return (
          <DeploymentProgressStep
            onBack={handleStepBack}
            onTerminate={handleTerminateDeployment}
            deploymentData={deploymentData}
          />
        )
      default:
        return null
    }
  }

  return (
    <div className="space-y-8">
      {/* Progress Steps */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <nav aria-label="Progress">
          <ol className="flex items-center">
            {steps.map((step, stepIdx) => (
              <li key={step.name} className={`relative ${stepIdx !== steps.length - 1 ? 'pr-8 sm:pr-20' : ''}`}>
                {step.status === 'completed' ? (
                  <>
                    <div className="absolute inset-0 flex items-center" aria-hidden="true">
                      <div className="h-0.5 w-full bg-success-600" />
                    </div>
                    <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-success-600">
                      <CheckIcon className="h-5 w-5 text-white" aria-hidden="true" />
                    </div>
                  </>
                ) : step.status === 'current' ? (
                  <>
                    <div className="absolute inset-0 flex items-center" aria-hidden="true">
                      <div className="h-0.5 w-full bg-gray-200" />
                    </div>
                    <div className="relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary-600 bg-white">
                      <span className="h-2.5 w-2.5 rounded-full bg-primary-600" aria-hidden="true" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="absolute inset-0 flex items-center" aria-hidden="true">
                      <div className="h-0.5 w-full bg-gray-200" />
                    </div>
                    <div className="group relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-gray-300 bg-white">
                      <span className="h-2.5 w-2.5 rounded-full bg-transparent group-hover:bg-gray-300" aria-hidden="true" />
                    </div>
                  </>
                )}
                <div className="mt-3">
                  <span className={`text-sm font-medium ${
                    step.status === 'current' ? 'text-primary-600' : 
                    step.status === 'completed' ? 'text-success-600' : 'text-gray-500'
                  }`}>
                    {step.name}
                  </span>
                  <p className="text-xs text-gray-500">{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </nav>
      </div>

      {/* Current Step Content */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {renderCurrentStep()}
      </div>
    </div>
  )
}