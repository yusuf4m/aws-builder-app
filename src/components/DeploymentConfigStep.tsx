'use client'

import { useState, useEffect } from 'react'
import { ArrowLeftIcon, CheckIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

type Environment = 'dev' | 'staging' | 'prod'
type SSLType = 'letsencrypt' | 'custom' | 'none'
type DatabaseEngine = 'postgres' | 'mysql'

interface DeploymentConfigStepProps {
  onComplete: (config: TerraformConfig) => void
  onBack: () => void
  environment?: Environment
  repository?: {
    url: string
    branch: string
    dockerImage?: string
    name?: string
  } & {
    pushToECR?: boolean
    imageTag?: string
    accessToken?: string
    ecrRepositoryName?: string
    ecrImageUri?: string
  }
  awsCredentials?: {
    accessKey: string
    secretKey: string
    region: string
  }
  initialConfig?: Partial<TerraformConfig>
}

interface TerraformConfig {
  // Project Configuration
  project_name: string
  environment: Environment
  aws_region: string
  destroy_mode?: boolean
  
  // VPC Configuration
  vpc_cidr: string
  availability_zones_count: number
  public_subnet_cidrs: string[]
  private_subnet_cidrs: string[]
  db_subnet_cidrs: string[]
  enable_nat_gateway: boolean
  single_nat_gateway: boolean
  
  // EKS Configuration
  kubernetes_version: string
  endpoint_private_access: boolean
  endpoint_public_access: boolean
  endpoint_public_access_cidrs: string[]
  enable_encryption: boolean
  
  // Node Group Configuration
  node_instance_types: string[]
  node_ami_type: string
  node_capacity_type: string
  node_disk_size: number
  node_desired_size: number
  node_max_size: number
  node_min_size: number
  
  // Database Configuration
  enable_database: boolean
  db_engine: DatabaseEngine
  db_engine_version: string
  db_instance_class: string
  db_allocated_storage: number
  db_database_name: string
  db_username: string
  db_port: number
  db_backup_retention_period: number
  db_multi_az: boolean
  db_storage_encrypted: boolean
  
  // SSL Configuration
  ssl_type: SSLType
  domain_name?: string
  ssl_certificate?: string
  ssl_private_key?: string
  enable_https: boolean
  
  // Storage Configuration
  enable_app_data_bucket: boolean
  enable_backup_bucket: boolean
  enable_versioning: boolean
  enable_kms_encryption: boolean
  
  // Monitoring Configuration
  enable_monitoring: boolean
  alert_emails: string[]
  alb_response_time_threshold: number
  node_cpu_threshold: number
  node_memory_threshold: number
}

const getEnvironmentDefaults = (env: Environment, repoName: string, awsRegion?: string): Partial<TerraformConfig> => {
  const prefix = env === 'dev' ? 'dev-' : env === 'staging' ? 'stg-' : 'prod-'
  const projectName = `${prefix}${repoName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`
  
  const baseConfig = {
    project_name: projectName,
    environment: env,
    aws_region: awsRegion || 'ap-northeast-1',
    vpc_cidr: '10.0.0.0/16',
    availability_zones_count: 2,
    public_subnet_cidrs: ['10.0.1.0/24', '10.0.2.0/24'],
    private_subnet_cidrs: ['10.0.10.0/24', '10.0.20.0/24'],
    db_subnet_cidrs: ['10.0.100.0/24', '10.0.200.0/24'],
    enable_nat_gateway: true,
    kubernetes_version: '1.28',
    endpoint_private_access: true,
    endpoint_public_access: true,
    endpoint_public_access_cidrs: ['0.0.0.0/0'],
    enable_encryption: true,
    node_instance_types: ['t3.medium'],
    node_ami_type: 'AL2_x86_64',
    node_capacity_type: 'ON_DEMAND',
    node_disk_size: 20,
    enable_database: true,
    db_engine: 'postgres' as DatabaseEngine,
    db_engine_version: '15.4',
    db_port: 5432,
    db_storage_encrypted: true,
    ssl_type: 'letsencrypt' as SSLType,
    enable_https: true,
    enable_app_data_bucket: true,
    enable_backup_bucket: true,
    enable_versioning: true,
    enable_kms_encryption: true,
    enable_monitoring: true,
    alert_emails: [],
  }
  
  if (env === 'dev') {
    return {
      ...baseConfig,
      single_nat_gateway: true,
      node_desired_size: 1,
      node_max_size: 2,
      node_min_size: 1,
      db_instance_class: 'db.t3.micro',
      db_allocated_storage: 20,
      db_backup_retention_period: 1,
      db_multi_az: false,
      alb_response_time_threshold: 2.0,
      node_cpu_threshold: 80,
      node_memory_threshold: 85,
    }
  } else if (env === 'staging') {
    return {
      ...baseConfig,
      single_nat_gateway: false,
      node_desired_size: 2,
      node_max_size: 4,
      node_min_size: 1,
      db_instance_class: 'db.t3.small',
      db_allocated_storage: 50,
      db_backup_retention_period: 7,
      db_multi_az: false,
      alb_response_time_threshold: 1.5,
      node_cpu_threshold: 75,
      node_memory_threshold: 80,
    }
  } else {
    return {
      ...baseConfig,
      single_nat_gateway: false,
      node_desired_size: 3,
      node_max_size: 10,
      node_min_size: 2,
      db_instance_class: 'db.t3.medium',
      db_allocated_storage: 100,
      db_backup_retention_period: 30,
      db_multi_az: true,
      alb_response_time_threshold: 1.0,
      node_cpu_threshold: 70,
      node_memory_threshold: 75,
    }
  }
}

export default function DeploymentConfigStep({ 
  onComplete, 
  onBack, 
  environment, 
  repository,
  awsCredentials,
  initialConfig 
}: DeploymentConfigStepProps) {
  const [config, setConfig] = useState<TerraformConfig>(() => {
    const defaults = getEnvironmentDefaults(environment || 'dev', repository?.name || 'app', awsCredentials?.region)
    return {
      ...defaults,
      ...initialConfig,
      db_database_name: `${defaults.project_name?.replace(/-/g, '_')}_db`,
      db_username: `${defaults.project_name?.replace(/-/g, '_')}_user`,
    } as TerraformConfig
  })
  
  const [activeSection, setActiveSection] = useState('project')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [newEmail, setNewEmail] = useState('')

  // Update aws_region dynamically when awsCredentials.region changes
  useEffect(() => {
    if (awsCredentials?.region && awsCredentials.region !== config.aws_region) {
      setConfig(prev => ({ ...prev, aws_region: awsCredentials.region }))
    }
  }, [awsCredentials?.region, config.aws_region])
  
  const sections = [
    { id: 'project', name: 'Project', icon: '🏗️' },
    { id: 'vpc', name: 'VPC & Network', icon: '🌐' },
    { id: 'eks', name: 'EKS Cluster', icon: '☸️' },
    { id: 'database', name: 'Database', icon: '🗄️' },
    { id: 'ssl', name: 'SSL & Domain', icon: '🔒' },
    { id: 'storage', name: 'Storage', icon: '💾' },
    { id: 'monitoring', name: 'Monitoring', icon: '📊' },
  ]
  
  const updateConfig = (field: keyof TerraformConfig, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }))
    // Clear error when field is updated
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }))
    }
  }
  
  const addArrayItem = (field: keyof TerraformConfig, value: string) => {
    const currentArray = config[field] as string[]
    updateConfig(field, [...currentArray, value])
  }
  
  const removeArrayItem = (field: keyof TerraformConfig, index: number) => {
    const currentArray = config[field] as string[]
    updateConfig(field, currentArray.filter((_, i) => i !== index))
  }
  
  const validateConfig = (): boolean => {
    const newErrors: Record<string, string> = {}
    
    // Project validation
    if (!config.project_name) newErrors.project_name = 'Project name is required'
    if (!config.aws_region) newErrors.aws_region = 'AWS region is required'
    
    // VPC validation
    if (!config.vpc_cidr) newErrors.vpc_cidr = 'VPC CIDR is required'
    if (config.public_subnet_cidrs.length === 0) newErrors.public_subnet_cidrs = 'At least one public subnet is required'
    if (config.private_subnet_cidrs.length === 0) newErrors.private_subnet_cidrs = 'At least one private subnet is required'
    
    // Database validation
    if (config.enable_database) {
      if (!config.db_database_name) newErrors.db_database_name = 'Database name is required'
      if (!config.db_username) newErrors.db_username = 'Database username is required'
    }
    
    // SSL validation
    if (config.ssl_type === 'custom') {
      if (!config.ssl_certificate) newErrors.ssl_certificate = 'SSL certificate is required'
      if (!config.ssl_private_key) newErrors.ssl_private_key = 'SSL private key is required'
    }
    if (config.ssl_type !== 'none' && !config.domain_name) {
      newErrors.domain_name = 'Domain name is required for SSL'
    }
    
    // Monitoring validation
    if (config.enable_monitoring && config.alert_emails.length === 0) {
      newErrors.alert_emails = 'At least one alert email is required'
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }
  
  const handleSubmit = (destroyMode = false) => {
    if (validateConfig()) {
      onComplete({ ...config, destroy_mode: destroyMode })
    }
  }
  
  const renderProjectSection = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Project Name *
          </label>
          <input
            type="text"
            value={config.project_name}
            onChange={(e) => updateConfig('project_name', e.target.value)}
            className={`input-field ${errors.project_name ? 'border-red-500' : ''}`}
            placeholder="my-awesome-app"
          />
          {errors.project_name && (
            <p className="text-red-500 text-sm mt-1">{errors.project_name}</p>
          )}
          <p className="text-gray-500 text-sm mt-1">
            Auto-generated with environment prefix: {environment === 'dev' ? 'dev-' : environment === 'staging' ? 'stg-' : 'prod-'}{repository?.name || 'app'}
          </p>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            AWS Region
          </label>
          <div className="input-field bg-gray-50 text-gray-600">
            {awsCredentials?.region || config.aws_region}
          </div>
          <p className="text-gray-500 text-sm mt-1">
            Region selected from AWS credentials
          </p>
        </div>
      </div>
    </div>
  )
  
  const renderVPCSection = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            VPC CIDR Block *
          </label>
          <input
            type="text"
            value={config.vpc_cidr}
            onChange={(e) => updateConfig('vpc_cidr', e.target.value)}
            className={`input-field ${errors.vpc_cidr ? 'border-red-500' : ''}`}
            placeholder="10.0.0.0/16"
          />
          {errors.vpc_cidr && (
            <p className="text-red-500 text-sm mt-1">{errors.vpc_cidr}</p>
          )}
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Availability Zones Count
          </label>
          <select
            value={config.availability_zones_count}
            onChange={(e) => updateConfig('availability_zones_count', parseInt(e.target.value))}
            className="input-field"
          >
            <option value={2}>2 AZs</option>
            <option value={3}>3 AZs</option>
            <option value={4}>4 AZs</option>
          </select>
        </div>
      </div>
      
      <div className="flex items-center space-x-4">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={config.enable_nat_gateway}
            onChange={(e) => updateConfig('enable_nat_gateway', e.target.checked)}
            className="mr-2"
          />
          Enable NAT Gateway
        </label>
        
        {config.enable_nat_gateway && (
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={config.single_nat_gateway}
              onChange={(e) => updateConfig('single_nat_gateway', e.target.checked)}
              className="mr-2"
            />
            Single NAT Gateway (cost optimization)
          </label>
        )}
      </div>
    </div>
  )
  
  const renderEKSSection = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Kubernetes Version
          </label>
          <select
            value={config.kubernetes_version}
            onChange={(e) => updateConfig('kubernetes_version', e.target.value)}
            className="input-field"
          >
            <option value="1.28">1.28</option>
            <option value="1.27">1.27</option>
            <option value="1.26">1.26</option>
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Node Instance Type
          </label>
          <select
            value={config.node_instance_types[0]}
            onChange={(e) => updateConfig('node_instance_types', [e.target.value])}
            className="input-field"
          >
            <option value="t3.micro">t3.micro (1 vCPU, 1GB RAM)</option>
            <option value="t3.small">t3.small (2 vCPU, 2GB RAM)</option>
            <option value="t3.medium">t3.medium (2 vCPU, 4GB RAM)</option>
            <option value="t3.large">t3.large (2 vCPU, 8GB RAM)</option>
            <option value="m5.large">m5.large (2 vCPU, 8GB RAM)</option>
          </select>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Min Nodes
          </label>
          <input
            type="number"
            min="1"
            max="10"
            value={config.node_min_size}
            onChange={(e) => updateConfig('node_min_size', parseInt(e.target.value))}
            className="input-field"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Desired Nodes
          </label>
          <input
            type="number"
            min="1"
            max="20"
            value={config.node_desired_size}
            onChange={(e) => updateConfig('node_desired_size', parseInt(e.target.value))}
            className="input-field"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Max Nodes
          </label>
          <input
            type="number"
            min="1"
            max="50"
            value={config.node_max_size}
            onChange={(e) => updateConfig('node_max_size', parseInt(e.target.value))}
            className="input-field"
          />
        </div>
      </div>
      
      <div className="flex items-center space-x-6">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={config.endpoint_private_access}
            onChange={(e) => updateConfig('endpoint_private_access', e.target.checked)}
            className="mr-2"
          />
          Private API Access
        </label>
        
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={config.endpoint_public_access}
            onChange={(e) => updateConfig('endpoint_public_access', e.target.checked)}
            className="mr-2"
          />
          Public API Access
        </label>
        
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={config.enable_encryption}
            onChange={(e) => updateConfig('enable_encryption', e.target.checked)}
            className="mr-2"
          />
          Enable Encryption
        </label>
      </div>
    </div>
  )
  
  const renderDatabaseSection = () => (
    <div className="space-y-6">
      <div className="flex items-center mb-4">
        <input
          type="checkbox"
          checked={config.enable_database}
          onChange={(e) => updateConfig('enable_database', e.target.checked)}
          className="mr-2"
        />
        <label className="text-sm font-medium text-gray-700">
          Enable Database (RDS)
        </label>
      </div>
      
      {config.enable_database && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Database Engine
              </label>
              <select
                value={config.db_engine}
                onChange={(e) => updateConfig('db_engine', e.target.value as DatabaseEngine)}
                className="input-field"
              >
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Instance Class
              </label>
              <select
                value={config.db_instance_class}
                onChange={(e) => updateConfig('db_instance_class', e.target.value)}
                className="input-field"
              >
                <option value="db.t3.micro">db.t3.micro (1 vCPU, 1GB RAM)</option>
                <option value="db.t3.small">db.t3.small (2 vCPU, 2GB RAM)</option>
                <option value="db.t3.medium">db.t3.medium (2 vCPU, 4GB RAM)</option>
                <option value="db.r5.large">db.r5.large (2 vCPU, 16GB RAM)</option>
              </select>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Database Name *
              </label>
              <input
                type="text"
                value={config.db_database_name}
                onChange={(e) => updateConfig('db_database_name', e.target.value)}
                className={`input-field ${errors.db_database_name ? 'border-red-500' : ''}`}
                placeholder="myapp_db"
              />
              {errors.db_database_name && (
                <p className="text-red-500 text-sm mt-1">{errors.db_database_name}</p>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Username *
              </label>
              <input
                type="text"
                value={config.db_username}
                onChange={(e) => updateConfig('db_username', e.target.value)}
                className={`input-field ${errors.db_username ? 'border-red-500' : ''}`}
                placeholder="myapp_user"
              />
              {errors.db_username && (
                <p className="text-red-500 text-sm mt-1">{errors.db_username}</p>
              )}
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Allocated Storage (GB)
              </label>
              <input
                type="number"
                min="20"
                max="1000"
                value={config.db_allocated_storage}
                onChange={(e) => updateConfig('db_allocated_storage', parseInt(e.target.value))}
                className="input-field"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Backup Retention (days)
              </label>
              <input
                type="number"
                min="0"
                max="35"
                value={config.db_backup_retention_period}
                onChange={(e) => updateConfig('db_backup_retention_period', parseInt(e.target.value))}
                className="input-field"
              />
            </div>
          </div>
          
          <div className="flex items-center space-x-6">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={config.db_multi_az}
                onChange={(e) => updateConfig('db_multi_az', e.target.checked)}
                className="mr-2"
              />
              Multi-AZ Deployment
            </label>
            
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={config.db_storage_encrypted}
                onChange={(e) => updateConfig('db_storage_encrypted', e.target.checked)}
                className="mr-2"
              />
              Storage Encryption
            </label>
          </div>
        </>
      )}
    </div>
  )
  
  const renderSSLSection = () => (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-4">
          SSL Certificate Configuration
        </label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { value: 'letsencrypt', label: 'Let\'s Encrypt', description: 'Free SSL certificate (auto-generated)' },
            { value: 'custom', label: 'Custom Certificate', description: 'Upload your own certificate and key' },
            { value: 'none', label: 'No SSL', description: 'HTTP only (not recommended for production)' }
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => updateConfig('ssl_type', option.value as SSLType)}
              className={`p-4 border-2 rounded-lg text-left transition-all ${
                config.ssl_type === option.value
                  ? 'border-primary-600 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-gray-900">{option.label}</h4>
                {config.ssl_type === option.value && (
                  <CheckIcon className="h-5 w-5 text-primary-600" />
                )}
              </div>
              <p className="text-sm text-gray-600">{option.description}</p>
            </button>
          ))}
        </div>
      </div>
      
      {config.ssl_type !== 'none' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Domain Name *
          </label>
          <input
            type="text"
            value={config.domain_name || ''}
            onChange={(e) => updateConfig('domain_name', e.target.value)}
            className={`input-field ${errors.domain_name ? 'border-red-500' : ''}`}
            placeholder="example.com"
          />
          {errors.domain_name && (
            <p className="text-red-500 text-sm mt-1">{errors.domain_name}</p>
          )}
        </div>
      )}
      
      {config.ssl_type === 'custom' && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              SSL Certificate (PEM format) *
            </label>
            <textarea
              value={config.ssl_certificate || ''}
              onChange={(e) => updateConfig('ssl_certificate', e.target.value)}
              className={`input-field h-32 ${errors.ssl_certificate ? 'border-red-500' : ''}`}
              placeholder="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
            />
            {errors.ssl_certificate && (
              <p className="text-red-500 text-sm mt-1">{errors.ssl_certificate}</p>
            )}
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              SSL Private Key (PEM format) *
            </label>
            <textarea
              value={config.ssl_private_key || ''}
              onChange={(e) => updateConfig('ssl_private_key', e.target.value)}
              className={`input-field h-32 ${errors.ssl_private_key ? 'border-red-500' : ''}`}
              placeholder="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
            />
            {errors.ssl_private_key && (
              <p className="text-red-500 text-sm mt-1">{errors.ssl_private_key}</p>
            )}
          </div>
        </>
      )}
    </div>
  )
  
  const renderStorageSection = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h4 className="font-medium text-gray-900">S3 Buckets</h4>
          
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={config.enable_app_data_bucket}
              onChange={(e) => updateConfig('enable_app_data_bucket', e.target.checked)}
              className="mr-2"
            />
            Application Data Bucket
          </label>
          
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={config.enable_backup_bucket}
              onChange={(e) => updateConfig('enable_backup_bucket', e.target.checked)}
              className="mr-2"
            />
            Backup Bucket
          </label>
        </div>
        
        <div className="space-y-4">
          <h4 className="font-medium text-gray-900">Storage Options</h4>
          
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={config.enable_versioning}
              onChange={(e) => updateConfig('enable_versioning', e.target.checked)}
              className="mr-2"
            />
            Enable Versioning
          </label>
          
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={config.enable_kms_encryption}
              onChange={(e) => updateConfig('enable_kms_encryption', e.target.checked)}
              className="mr-2"
            />
            KMS Encryption
          </label>
        </div>
      </div>
    </div>
  )
  
  const renderMonitoringSection = () => {
    const addEmail = () => {
      if (newEmail && !config.alert_emails.includes(newEmail)) {
        addArrayItem('alert_emails', newEmail)
        setNewEmail('')
      }
    }
    
    return (
      <div className="space-y-6">
        <div className="flex items-center mb-4">
          <input
            type="checkbox"
            checked={config.enable_monitoring}
            onChange={(e) => updateConfig('enable_monitoring', e.target.checked)}
            className="mr-2"
          />
          <label className="text-sm font-medium text-gray-700">
            Enable Monitoring & Alerts
          </label>
        </div>
        
        {config.enable_monitoring && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Alert Email Addresses *
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="input-field flex-1"
                  placeholder="admin@example.com"
                  onKeyPress={(e) => e.key === 'Enter' && addEmail()}
                />
                <button
                  type="button"
                  onClick={addEmail}
                  className="btn-secondary"
                >
                  Add
                </button>
              </div>
              
              <div className="space-y-1">
                {config.alert_emails.map((email, index) => (
                  <div key={index} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                    <span className="text-sm">{email}</span>
                    <button
                      type="button"
                      onClick={() => removeArrayItem('alert_emails', index)}
                      className="text-red-600 hover:text-red-700"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              
              {errors.alert_emails && (
                <p className="text-red-500 text-sm mt-1">{errors.alert_emails}</p>
              )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  ALB Response Time Threshold (seconds)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="10"
                  value={config.alb_response_time_threshold}
                  onChange={(e) => updateConfig('alb_response_time_threshold', parseFloat(e.target.value))}
                  className="input-field"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Node CPU Threshold (%)
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={config.node_cpu_threshold}
                  onChange={(e) => updateConfig('node_cpu_threshold', parseInt(e.target.value))}
                  className="input-field"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Node Memory Threshold (%)
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={config.node_memory_threshold}
                  onChange={(e) => updateConfig('node_memory_threshold', parseInt(e.target.value))}
                  className="input-field"
                />
              </div>
            </div>
          </>
        )}
      </div>
    )
  }
  
  const renderCurrentSection = () => {
    switch (activeSection) {
      case 'project': return renderProjectSection()
      case 'vpc': return renderVPCSection()
      case 'eks': return renderEKSSection()
      case 'database': return renderDatabaseSection()
      case 'ssl': return renderSSLSection()
      case 'storage': return renderStorageSection()
      case 'monitoring': return renderMonitoringSection()
      default: return renderProjectSection()
    }
  }
  
  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Infrastructure Configuration
        </h2>
        <p className="text-gray-600">
          Configure your {environment} environment infrastructure settings
        </p>
      </div>
      
      {/* Section Navigation */}
      <div className="mb-8">
        <div className="flex flex-wrap gap-2">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeSection === section.id
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span className="mr-2">{section.icon}</span>
              {section.name}
            </button>
          ))}
        </div>
      </div>
      
      {/* Current Section Content */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
        <h3 className="text-lg font-medium text-gray-900 mb-6">
          {sections.find(s => s.id === activeSection)?.icon} {sections.find(s => s.id === activeSection)?.name}
        </h3>
        {renderCurrentSection()}
      </div>
      
      {/* Navigation */}
      <div className="flex justify-between pt-6">
        <button
          type="button"
          onClick={onBack}
          className="btn-secondary flex items-center"
        >
          <ArrowLeftIcon className="h-4 w-4 mr-2" />
          Back
        </button>
        
        <div className="flex space-x-3">
          <button
            type="button"
            onClick={() => handleSubmit(true)}
            className="btn-secondary text-red-600 border-red-300 hover:bg-red-50 flex items-center"
          >
            🗑️ Terraform Destroy
          </button>
          
          <button
            type="button"
            onClick={() => handleSubmit(false)}
            className="btn-primary flex items-center"
          >
            Continue to Deploy
            {Object.keys(errors).length > 0 && (
              <ExclamationTriangleIcon className="h-4 w-4 ml-2 text-yellow-400" />
            )}
          </button>
        </div>
      </div>
      
      {/* Error Summary */}
      {Object.keys(errors).length > 0 && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center mb-2">
            <ExclamationTriangleIcon className="h-5 w-5 text-red-600 mr-2" />
            <h4 className="text-sm font-medium text-red-800">
              Please fix the following errors:
            </h4>
          </div>
          <ul className="text-sm text-red-700 list-disc list-inside">
            {Object.entries(errors).map(([field, error]) => (
              <li key={field}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export type { TerraformConfig, Environment, SSLType, DatabaseEngine }