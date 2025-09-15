'use client'

import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeftIcon, CodeBracketIcon } from '@heroicons/react/24/outline'
import { io, Socket } from 'socket.io-client'

const repositorySchema = z.object({
  url: z.string().url('Please enter a valid repository URL'),
  branch: z.string().min(1, 'Branch is required'),
  accessToken: z.string().optional(),
  pushToECR: z.boolean().default(false),
  ecrRepositoryName: z.string().optional(),
  imageTag: z.string().default('latest'),
  ecrImageUri: z.string().optional()
})

type RepositoryForm = z.infer<typeof repositorySchema>

interface RepositoryStepProps {
  onComplete: (data: { 
    repository: RepositoryForm & { 
      dockerImage?: string; 
      name?: string; 
      ecrImageUri?: string;
      ecrConfig?: {
        repositoryName: string;
        imageTag: string;
        accountId?: string;
        region?: string;
      }
    }; 
    [key: string]: any 
  }) => void
  onBack: () => void
  initialData?: RepositoryForm & { dockerImage?: string; name?: string; ecrImageUri?: string }
  awsCredentials?: {
    accessKey: string
    secretKey: string
    region: string
    accountId?: string
  }
}

// Helper function to extract repository name from URL
const extractRepoName = (url: string): string => {
  if (!url) return ''
  const match = url.match(/\/([^/]+?)(\.git)?$/)
  return match ? match[1] : ''
}

export default function RepositoryStep({ onComplete, onBack, initialData, awsCredentials }: RepositoryStepProps) {
  const [branches, setBranches] = useState<string[]>([])
  const [isLoadingBranches, setIsLoadingBranches] = useState(false)
  const [isBuildingImage, setIsBuildingImage] = useState(false)
  const [buildProgress, setBuildProgress] = useState('')
  const [buildSteps, setBuildSteps] = useState<Array<{step: string, status: 'pending' | 'active' | 'completed' | 'error', message?: string}>>([])
  const [isValidatingToken, setIsValidatingToken] = useState(false)
  const [tokenValidationError, setTokenValidationError] = useState('')
  const [isTokenValidated, setIsTokenValidated] = useState(false)
  const [realTimeLogs, setRealTimeLogs] = useState<Array<{timestamp: Date, message: string, level: string, buildId?: string, operationId?: string}>>([])
  const [showLogs, setShowLogs] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    watch,
    setValue
  } = useForm<RepositoryForm>({
    resolver: zodResolver(repositorySchema),
    defaultValues: initialData || {
      url: '',
      branch: 'main',
      accessToken: '',
      pushToECR: false,
      ecrRepositoryName: '',
      imageTag: 'latest'
    },
    mode: 'onChange'
  })

  const watchedUrl = watch('url')

  // WebSocket setup
  useEffect(() => {
    // Initialize socket connection
    socketRef.current = io('http://localhost:3001')
    
    // Listen for Docker build logs
    socketRef.current.on('docker-build-log', (logEntry: any) => {
      setRealTimeLogs(prev => [...prev, {
        ...logEntry,
        timestamp: new Date(logEntry.timestamp)
      }])
      setShowLogs(true)
    })
    
    // Listen for ECR push logs
    socketRef.current.on('ecr-log', (logEntry: any) => {
      setRealTimeLogs(prev => [...prev, {
        ...logEntry,
        timestamp: new Date(logEntry.timestamp)
      }])
      setShowLogs(true)
    })
    
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect()
      }
    }
  }, [])

  const validateTokenAndFetchBranches = async (repoUrl: string, accessToken: string) => {
    if (!repoUrl) return
    
    setIsValidatingToken(true)
    setTokenValidationError('')
    setIsTokenValidated(false)
    setBranches([])
    
    try {
      // First validate the repository and token
      const validateResponse = await fetch('http://localhost:3001/api/github/validate-repository', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: repoUrl,
          accessToken: accessToken || ''
        }),
      })
      
      const validateResult = await validateResponse.json()
      
      if (!validateResult.success) {
        setTokenValidationError(validateResult.message || 'Repository validation failed')
        return
      }
      
      setIsTokenValidated(true)
      
      // If validation successful, fetch branches
      setIsLoadingBranches(true)
      const branchResponse = await fetch('http://localhost:3001/api/github/get-branches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: repoUrl,
          accessToken: accessToken || ''
        }),
      })
      
      const branchResult = await branchResponse.json()
      
      if (branchResult.success) {
        setBranches(branchResult.branches.map((b: any) => b.name || b))
        
        const branchNames = branchResult.branches.map((b: any) => b.name || b)
        if (branchNames.includes('main')) {
          setValue('branch', 'main')
        } else if (branchNames.length > 0) {
          setValue('branch', branchNames[0])
        }
      } else {
        console.error('Failed to fetch branches:', branchResult.message)
        setBranches(['main', 'master'])
      }
    } catch (error) {
      console.error('Failed to validate repository or fetch branches:', error)
      setTokenValidationError('Failed to connect to repository. Please check your URL and access token.')
      setBranches(['main', 'master'])
    } finally {
      setIsValidatingToken(false)
      setIsLoadingBranches(false)
    }
  }

  const buildDockerImage = async (data: RepositoryForm) => {
    setIsBuildingImage(true)
    setBuildProgress('Starting build process...')
    setRealTimeLogs([]) // Clear previous logs
    setShowLogs(false)
    
    const steps = [
      { step: 'validate', status: 'pending' as const, message: 'Validating repository access' },
      { step: 'clone', status: 'pending' as const, message: 'Cloning repository' },
      { step: 'dockerfile', status: 'pending' as const, message: 'Checking Dockerfile' },
      { step: 'build', status: 'pending' as const, message: 'Building Docker image' },
      ...(data.pushToECR ? [
        { step: 'ecr-create', status: 'pending' as const, message: 'Creating ECR repository' },
        { step: 'ecr-push', status: 'pending' as const, message: 'Pushing image to ECR' }
      ] : []),
      { step: 'complete', status: 'pending' as const, message: 'Finalizing build' }
    ]
    setBuildSteps(steps)
    
    try {
      // Step 1: Validate repository
      setBuildSteps(prev => prev.map(s => s.step === 'validate' ? {...s, status: 'active'} : s))
      setBuildProgress('Validating repository access...')
      
      const validateResponse = await fetch('http://localhost:3001/api/github/validate-repository', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: data.url,
          branch: data.branch,
          accessToken: data.accessToken || ''
        }),
      })
      
      const validateResult = await validateResponse.json()
      
      if (!validateResult.success) {
        setBuildSteps(prev => prev.map(s => s.step === 'validate' ? {...s, status: 'error', message: validateResult.message} : s))
        throw new Error(validateResult.message || 'Repository validation failed')
      }
      
      setBuildSteps(prev => prev.map(s => s.step === 'validate' ? {...s, status: 'completed'} : s))
      
      // Step 2-5: Build Docker image (backend handles clone, dockerfile check, and build)
      setBuildSteps(prev => prev.map(s => ['clone', 'dockerfile', 'build'].includes(s.step) ? {...s, status: 'active'} : s))
      setBuildProgress('Building Docker image from repository...')
      
      // Generate the expected image name format (same as backend)
      const repoName = extractRepoName(data.url)
      const expectedImageName = `${repoName}:${data.imageTag || 'latest'}`
      
      const buildResponse = await fetch('http://localhost:3001/api/docker/build', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: data.url,
          branch: data.branch,
          accessToken: data.accessToken,
          imageName: repoName,
          imageTag: data.imageTag || 'latest',
          awsCredentials
        }),
      })
      
      const buildResult = await buildResponse.json()
      
      if (!buildResult.success) {
        setBuildSteps(prev => prev.map(s => ['clone', 'dockerfile', 'build'].includes(s.step) ? {...s, status: 'error', message: buildResult.message} : s))
        throw new Error(buildResult.message || 'Docker build failed')
      }
      
      // Mark build steps as completed
      setBuildSteps(prev => prev.map(s => 
        ['clone', 'dockerfile', 'build'].includes(s.step) ? {...s, status: 'completed'} : s
      ))
      
      let ecrImageUri = ''
      
      // ECR Push Steps (if enabled)
      if (data.pushToECR && awsCredentials) {
        const repositoryName = data.ecrRepositoryName || extractRepoName(data.url)
        const imageTag = data.imageTag || 'latest'
        
        // Step: Create ECR Repository
        setBuildSteps(prev => prev.map(s => s.step === 'ecr-create' ? {...s, status: 'active'} : s))
        setBuildProgress('Creating ECR repository...')
        
        const createRepoResponse = await fetch('http://localhost:3001/api/ecr/create-repository', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            repositoryName,
            awsCredentials: {
              accessKeyId: awsCredentials.accessKey,
              secretAccessKey: awsCredentials.secretKey,
              region: awsCredentials.region
            }
          }),
        })
        
        const createRepoResult = await createRepoResponse.json()
        
        if (!createRepoResult.success) {
          setBuildSteps(prev => prev.map(s => s.step === 'ecr-create' ? {...s, status: 'error', message: createRepoResult.message} : s))
          throw new Error(createRepoResult.message || 'ECR repository creation failed')
        }
        
        setBuildSteps(prev => prev.map(s => s.step === 'ecr-create' ? {...s, status: 'completed'} : s))
        
        // Step: Push to ECR
        setBuildSteps(prev => prev.map(s => s.step === 'ecr-push' ? {...s, status: 'active'} : s))
        setBuildProgress('Pushing image to ECR...')
        
        const pushResponse = await fetch('http://localhost:3001/api/ecr/push-image', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            imageName: expectedImageName,
            repositoryName,
            imageTag,
            awsCredentials: {
              accessKeyId: awsCredentials.accessKey,
              secretAccessKey: awsCredentials.secretKey,
              region: awsCredentials.region,
              accountId: awsCredentials.accountId
            }
          }),
        })
        
        const pushResult = await pushResponse.json()
        
        if (!pushResult.success) {
          setBuildSteps(prev => prev.map(s => s.step === 'ecr-push' ? {...s, status: 'error', message: pushResult.message} : s))
          throw new Error(pushResult.message || 'ECR push failed')
        }
        
        setBuildSteps(prev => prev.map(s => s.step === 'ecr-push' ? {...s, status: 'completed'} : s))
        ecrImageUri = pushResult.imageUri
      }
      
      // Step: Complete
      setBuildSteps(prev => prev.map(s => s.step === 'complete' ? {...s, status: 'active'} : s))
      setBuildProgress(data.pushToECR ? 'Image built and pushed to ECR successfully!' : 'Docker image built successfully!')
      
      setTimeout(() => {
        setBuildSteps(prev => prev.map(s => s.step === 'complete' ? {...s, status: 'completed'} : s))
        
        const repositoryName = data.ecrRepositoryName || extractRepoName(data.url)
        const imageTag = data.imageTag || 'latest'
        
        onComplete({
          repository: {
            ...data,
            dockerImage: buildResult.image?.name || buildResult.image?.id,
            name: extractRepoName(data.url),
            ...(ecrImageUri && { ecrImageUri }),
            ...(data.pushToECR && awsCredentials && {
              ecrConfig: {
                repositoryName,
                imageTag,
                accountId: awsCredentials.accountId,
                region: awsCredentials.region
              }
            })
          }
        })
      }, 1000)
      
    } catch (error) {
      console.error('Docker build failed:', error)
      setBuildProgress('Build failed')
      
      // Update build steps to show error
      setBuildSteps(prev => prev.map((step, index) => {
        if (index === prev.length - 1) {
          return {
            ...step,
            status: 'error' as const,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
          }
        }
        return step
      }))
      
      // Show detailed error message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const isImageNotFound = errorMessage.includes('no such image')
      const isRepoNotFound = errorMessage.includes('Repository not found') || errorMessage.includes('repository not found')
      const isDockerfileNotFound = errorMessage.includes('No Dockerfile found')
      
      let userFriendlyMessage = 'Failed to build Docker image.'
       let suggestions: string[] = []
      
      if (isImageNotFound) {
        userFriendlyMessage = 'Docker image not found. This usually means a previous build failed.'
        suggestions = [
          'Check if your repository has a valid Dockerfile',
          'Ensure all dependencies can be installed',
          'Try building the image locally first'
        ]
      } else if (isRepoNotFound) {
        userFriendlyMessage = 'Repository not found or access denied.'
        suggestions = [
          'Check if the repository URL is correct',
          'Ensure the repository is public or provide a valid access token',
          'Verify the branch name exists'
        ]
      } else if (isDockerfileNotFound) {
        userFriendlyMessage = 'No Dockerfile found in the repository root.'
        suggestions = [
          'Add a Dockerfile to your repository root',
          'Check if the Dockerfile is in a subdirectory',
          'Ensure the repository structure is correct'
        ]
      }
      
      alert(`${userFriendlyMessage}\n\nSuggestions:\n${suggestions.map(s => `• ${s}`).join('\n')}\n\nTechnical details: ${errorMessage}`)
    } finally {
      // Check if there's an error to determine timeout
       const currentSteps = buildSteps
       const hasError = currentSteps.some(step => step.status === 'error')
       
       setTimeout(() => {
         setIsBuildingImage(false)
         setBuildProgress('')
         // Don't clear build steps immediately if there's an error, let user see it
         setBuildSteps(prev => {
           const hasError = prev.some(step => step.status === 'error')
           return hasError ? prev : []
         })
       }, hasError ? 5000 : 2000) // Keep error visible longer
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Repository Selection</h2>
        <p className="text-gray-600">
          Select your repository and branch. We'll automatically build a Docker image for deployment.
        </p>
      </div>

      <form onSubmit={handleSubmit(buildDockerImage)} className="space-y-6">
        <div>
          <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-2">
            Repository URL
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <CodeBracketIcon className="h-5 w-5 text-gray-400" />
            </div>
            <input
              {...register('url')}
              type="url"
              id="url"
              className="input-field pl-10"
              placeholder="https://github.com/username/repository.git"
            />
          </div>
          {errors.url && (
            <p className="mt-1 text-sm text-error-600">{errors.url.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="branch" className="block text-sm font-medium text-gray-700 mb-2">
            Branch
          </label>
          <select
            {...register('branch')}
            id="branch"
            className="input-field"
            disabled={isLoadingBranches || isValidatingToken || (!isTokenValidated && !!watchedUrl)}
          >
            {isValidatingToken ? (
              <option>Validating repository...</option>
            ) : isLoadingBranches ? (
              <option>Loading branches...</option>
            ) : !isTokenValidated && !!watchedUrl ? (
              <option>Please validate repository first</option>
            ) : branches.length > 0 ? (
              branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))
            ) : (
              <option value="main">main</option>
            )}
          </select>
          {errors.branch && (
            <p className="mt-1 text-sm text-error-600">{errors.branch.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="accessToken" className="block text-sm font-medium text-gray-700 mb-2">
            GitHub Access Token (Optional)
          </label>
          <div className="flex gap-2">
            <input
              {...register('accessToken')}
              type="password"
              id="accessToken"
              className="input-field flex-1"
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            />
            <button
              type="button"
              onClick={() => validateTokenAndFetchBranches(watchedUrl, watch('accessToken') || '')}
              disabled={!watchedUrl || isValidatingToken}
              className="btn-secondary whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isValidatingToken ? 'Validating...' : 'Validate & Load Branches'}
            </button>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Required for private repositories. Generate one at GitHub Settings → Developer settings → Personal access tokens.
          </p>
          {tokenValidationError && (
            <p className="mt-1 text-sm text-error-600">{tokenValidationError}</p>
          )}
          {isTokenValidated && !tokenValidationError && (
            <p className="mt-1 text-sm text-green-600">✓ Repository access validated successfully</p>
          )}
          {errors.accessToken && (
            <p className="mt-1 text-sm text-error-600">{errors.accessToken.message}</p>
          )}
        </div>

        {/* ECR Push Configuration */}
        {awsCredentials && (
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <div className="flex items-center mb-4">
              <input
                {...register('pushToECR')}
                type="checkbox"
                id="pushToECR"
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="pushToECR" className="ml-2 block text-sm font-medium text-gray-700">
                Push image to Amazon ECR
              </label>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Automatically create an ECR repository and push the built Docker image for easy deployment.
            </p>
            
            {watch('pushToECR') && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="ecrRepositoryName" className="block text-sm font-medium text-gray-700 mb-2">
                    ECR Repository Name (Optional)
                  </label>
                  <input
                    {...register('ecrRepositoryName')}
                    type="text"
                    id="ecrRepositoryName"
                    className="input-field"
                    placeholder={`Auto-generated: ${extractRepoName(watchedUrl || '')}`}
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    Leave empty to use the repository name from the Git URL.
                  </p>
                  {errors.ecrRepositoryName && (
                    <p className="mt-1 text-sm text-error-600">{errors.ecrRepositoryName.message}</p>
                  )}
                </div>
                
                <div>
                  <label htmlFor="imageTag" className="block text-sm font-medium text-gray-700 mb-2">
                    Image Tag
                  </label>
                  <input
                    {...register('imageTag')}
                    type="text"
                    id="imageTag"
                    className="input-field"
                    placeholder="latest"
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    Tag for the Docker image in ECR (e.g., latest, v1.0.0, dev).
                  </p>
                  {errors.imageTag && (
                    <p className="mt-1 text-sm text-error-600">{errors.imageTag.message}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {isBuildingImage && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6">
            <div className="mb-4">
              <div className="flex items-center mb-2">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-blue-800 font-semibold text-lg">{buildProgress}</span>
              </div>
              
              {/* Progress bar */}
              <div className="w-full bg-blue-200 rounded-full h-2 mb-4">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${(buildSteps.filter(s => s.status === 'completed').length / buildSteps.length) * 100}%` }}
                ></div>
              </div>
            </div>
            
            {/* Build steps */}
            <div className="space-y-3">
              {buildSteps.map((step, index) => (
                <div key={step.step} className="flex items-center">
                  <div className="flex-shrink-0 mr-3">
                    {step.status === 'completed' && (
                      <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                    {step.status === 'active' && (
                      <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                        <svg className="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      </div>
                    )}
                    {step.status === 'error' && (
                      <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </div>
                    )}
                    {step.status === 'pending' && (
                      <div className="w-6 h-6 bg-gray-300 rounded-full flex items-center justify-center">
                        <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className={`font-medium ${
                      step.status === 'completed' ? 'text-green-700' :
                      step.status === 'active' ? 'text-blue-700' :
                      step.status === 'error' ? 'text-red-700' :
                      'text-gray-500'
                    }`}>
                      {step.message}
                    </div>
                    {step.status === 'error' && step.message && (
                      <div className="text-sm text-red-600 mt-1">
                        Error: {step.message}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Real-time Logs Display */}
        {showLogs && realTimeLogs.length > 0 && (
          <div className="bg-gray-900 rounded-lg p-4 mt-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-semibold text-sm">Real-time Build & Push Logs</h3>
              <button
                type="button"
                onClick={() => setShowLogs(false)}
                className="text-gray-400 hover:text-white text-sm"
              >
                Hide Logs
              </button>
            </div>
            <div className="bg-black rounded p-3 max-h-64 overflow-y-auto font-mono text-xs">
              {realTimeLogs.map((log, index) => (
                <div key={index} className={`mb-1 ${
                  log.level === 'error' ? 'text-red-400' :
                  log.level === 'success' ? 'text-green-400' :
                  'text-gray-300'
                }`}>
                  <span className="text-gray-500">
                    [{log.timestamp.toLocaleTimeString()}]
                  </span>
                  <span className="ml-2">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-between pt-6">
          <button
            type="button"
            onClick={onBack}
            className="btn-secondary flex items-center"
            disabled={isBuildingImage}
          >
            <ArrowLeftIcon className="h-4 w-4 mr-2" />
            Back
          </button>
          <button
            type="submit"
            disabled={!isValid || isBuildingImage || (!isTokenValidated && !!watchedUrl)}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isBuildingImage ? 'Building Image...' : 'Build & Continue'}
          </button>
        </div>
      </form>
    </div>
  )
}