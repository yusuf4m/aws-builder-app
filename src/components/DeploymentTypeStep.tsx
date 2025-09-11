'use client'

import { useState } from 'react'
import { ArrowLeftIcon, ServerIcon, GlobeAltIcon } from '@heroicons/react/24/outline'

type DeploymentType = 'backend' | 'frontend'
type Environment = 'dev' | 'staging' | 'prod'

interface DeploymentTypeStepProps {
  onComplete: (data: { deploymentType: DeploymentType; environment: Environment; deploymentConfig: any }) => void
  onBack: () => void
  initialData?: { deploymentType: DeploymentType; environment: Environment }
  repository?: {
    url: string
    branch: string
    dockerImage?: string
  }
}

interface DeploymentConfig {
  replicas: number
  port: number
  resources: {
    requests: {
      cpu: string
      memory: string
    }
    limits: {
      cpu: string
      memory: string
    }
  }
  environment: { [key: string]: string }
  healthCheck: {
    path: string
    port: number
  }
}

export default function DeploymentTypeStep({ onComplete, onBack, initialData, repository }: DeploymentTypeStepProps) {
  const [selectedType, setSelectedType] = useState<DeploymentType>(initialData?.deploymentType || 'backend')
  const [selectedEnvironment, setSelectedEnvironment] = useState<Environment>(initialData?.environment || 'dev')
  const [config, setConfig] = useState<DeploymentConfig>({
    replicas: 2,
    port: selectedType === 'backend' ? 8000 : 3000,
    resources: {
      requests: {
        cpu: '100m',
        memory: '128Mi'
      },
      limits: {
        cpu: '500m',
        memory: '512Mi'
      }
    },
    environment: selectedType === 'backend' ? {
      'NODE_ENV': 'production',
      'PORT': '8000'
    } : {
      'NODE_ENV': 'production',
      'PORT': '3000'
    },
    healthCheck: {
      path: selectedType === 'backend' ? '/health' : '/',
      port: selectedType === 'backend' ? 8000 : 3000
    }
  })

  const deploymentTypes = [
    {
      id: 'backend' as DeploymentType,
      name: 'Backend API',
      description: 'Deploy a backend service with API endpoints, database connections, and business logic',
      icon: ServerIcon,
      features: [
        'API endpoints and GraphQL support',
        'Database connectivity (PostgreSQL/MySQL)',
        'Authentication and authorization',
        'Background job processing',
        'Monitoring and logging'
      ],
      defaultPort: 8000,
      defaultHealthPath: '/health'
    },
    {
      id: 'frontend' as DeploymentType,
      name: 'Frontend App',
      description: 'Deploy a frontend application with static assets, routing, and user interface',
      icon: GlobeAltIcon,
      features: [
        'Static asset serving',
        'Client-side routing',
        'CDN integration',
        'SEO optimization',
        'Performance monitoring'
      ],
      defaultPort: 3000,
      defaultHealthPath: '/'
    }
  ]

  const handleTypeChange = (type: DeploymentType) => {
    setSelectedType(type)
    const selectedTypeConfig = deploymentTypes.find(t => t.id === type)
    if (selectedTypeConfig) {
      setConfig(prev => ({
        ...prev,
        port: selectedTypeConfig.defaultPort,
        healthCheck: {
          ...prev.healthCheck,
          path: selectedTypeConfig.defaultHealthPath,
          port: selectedTypeConfig.defaultPort
        },
        environment: type === 'backend' ? {
          'NODE_ENV': 'production',
          'PORT': selectedTypeConfig.defaultPort.toString()
        } : {
          'NODE_ENV': 'production',
          'PORT': selectedTypeConfig.defaultPort.toString()
        }
      }))
    }
  }

  const handleConfigChange = (field: string, value: any) => {
    setConfig(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const handleEnvironmentChange = (key: string, value: string) => {
    setConfig(prev => ({
      ...prev,
      environment: {
        ...prev.environment,
        [key]: value
      }
    }))
  }

  const addEnvironmentVariable = () => {
    const key = prompt('Enter environment variable name:')
    if (key && !config.environment[key]) {
      handleEnvironmentChange(key, '')
    }
  }

  const removeEnvironmentVariable = (key: string) => {
    setConfig(prev => {
      const newEnv = { ...prev.environment }
      delete newEnv[key]
      return {
        ...prev,
        environment: newEnv
      }
    })
  }

  const handleSubmit = () => {
    onComplete({
      deploymentType: selectedType,
      environment: selectedEnvironment,
      deploymentConfig: config
    })
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Deployment Configuration</h2>
        <p className="text-gray-600">
          Choose your deployment type and configure the application settings.
        </p>
      </div>

      {/* Deployment Type Selection */}
      <div className="mb-8">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Deployment Type</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {deploymentTypes.map((type) => {
            const IconComponent = type.icon
            return (
              <button
                key={type.id}
                onClick={() => handleTypeChange(type.id)}
                className={`p-6 border-2 rounded-lg text-left transition-all ${
                  selectedType === type.id
                    ? 'border-primary-600 bg-primary-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center mb-3">
                  <IconComponent className="h-6 w-6 text-primary-600 mr-3" />
                  <h4 className="font-medium text-gray-900">{type.name}</h4>
                </div>
                <p className="text-sm text-gray-600 mb-4">{type.description}</p>
                <div className="space-y-1">
                  {type.features.map((feature, index) => (
                    <div key={index} className="flex items-center text-xs text-gray-500">
                      <div className="w-1 h-1 bg-gray-400 rounded-full mr-2" />
                      {feature}
                    </div>
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Environment Selection */}
      <div className="mb-8">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Select Environment</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { value: 'dev', label: 'Development', description: 'For development and testing' },
            { value: 'staging', label: 'Staging', description: 'Pre-production environment' },
            { value: 'prod', label: 'Production', description: 'Live production environment' }
          ].map((env) => (
            <button
              key={env.value}
              onClick={() => setSelectedEnvironment(env.value as Environment)}
              className={`p-4 border-2 rounded-lg text-left transition-all ${
                selectedEnvironment === env.value
                  ? 'border-primary-600 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-gray-900">{env.label}</h4>
                <div className={`w-3 h-3 rounded-full ${
                  env.value === 'prod' ? 'bg-red-500' : 
                  env.value === 'staging' ? 'bg-yellow-500' : 'bg-green-500'
                }`} />
              </div>
              <p className="text-sm text-gray-600">{env.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Configuration Section */}
      <div className="mb-8">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Application Configuration</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Replicas
            </label>
            <input
              type="number"
              min="1"
              max="10"
              value={config.replicas}
              onChange={(e) => handleConfigChange('replicas', parseInt(e.target.value))}
              className="input-field"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Port
            </label>
            <input
              type="number"
              min="1"
              max="65535"
              value={config.port}
              onChange={(e) => handleConfigChange('port', parseInt(e.target.value))}
              className="input-field"
            />
          </div>
        </div>

        {/* Environment Variables */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <label className="block text-sm font-medium text-gray-700">
              Environment Variables
            </label>
            <button
              type="button"
              onClick={addEnvironmentVariable}
              className="text-sm text-primary-600 hover:text-primary-700"
            >
              + Add Variable
            </button>
          </div>
          <div className="space-y-2">
            {Object.entries(config.environment).map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <input
                  type="text"
                  value={key}
                  readOnly
                  className="input-field flex-1 bg-gray-50"
                />
                <input
                  type="text"
                  value={value}
                  onChange={(e) => handleEnvironmentChange(key, e.target.value)}
                  className="input-field flex-1"
                  placeholder="Value"
                />
                <button
                  type="button"
                  onClick={() => removeEnvironmentVariable(key)}
                  className="px-3 py-2 text-error-600 hover:text-error-700"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-between pt-6">
        <button
          type="button"
          onClick={onBack}
          className="btn-secondary flex items-center"
        >
          <ArrowLeftIcon className="h-4 w-4 mr-2" />
          Back
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          className="btn-primary"
        >
          Continue to Deploy
        </button>
      </div>
    </div>
  )
}