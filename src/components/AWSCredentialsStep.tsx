'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline'

const awsCredentialsSchema = z.object({
  accessKey: z.string().min(16, 'Access Key must be at least 16 characters'),
  secretKey: z.string().min(32, 'Secret Key must be at least 32 characters'),
  region: z.string().min(1, 'Region is required'),
  accountId: z.string().optional()
})

type AWSCredentialsForm = z.infer<typeof awsCredentialsSchema>

interface AWSCredentialsStepProps {
  onComplete: (data: { awsCredentials: AWSCredentialsForm; [key: string]: any }) => void
  initialData?: AWSCredentialsForm
}

const AWS_REGIONS = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-east-2', label: 'US East (Ohio)' },
  { value: 'us-west-1', label: 'US West (N. California)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'ap-south-1', label: 'Asia Pacific (Mumbai)' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
  { value: 'ap-northeast-2', label: 'Asia Pacific (Seoul)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
  { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
  { value: 'eu-central-1', label: 'Europe (Frankfurt)' },
  { value: 'eu-west-1', label: 'Europe (Ireland)' },
  { value: 'eu-west-2', label: 'Europe (London)' },
  { value: 'eu-west-3', label: 'Europe (Paris)' },
]

export default function AWSCredentialsStep({ onComplete, initialData }: AWSCredentialsStepProps) {
  const [showSecretKey, setShowSecretKey] = useState(false)
  const [isValidating, setIsValidating] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    watch
  } = useForm<AWSCredentialsForm>({
    resolver: zodResolver(awsCredentialsSchema),
    defaultValues: initialData || {
      accessKey: '',
      secretKey: '',
      region: 'us-east-1'
    },
    mode: 'onChange'
  })

  const validateAWSCredentials = async (data: AWSCredentialsForm) => {
    setIsValidating(true)
    try {
      // Trim whitespace from inputs
      const trimmedData = {
        accessKey: data.accessKey.trim(),
        secretKey: data.secretKey.trim(),
        region: data.region.trim()
      }
      
      // Basic client-side validation
      if (!trimmedData.accessKey || trimmedData.accessKey.length < 16) {
        alert('Access Key ID must be at least 16 characters long')
        setIsValidating(false)
        return
      }
      
      if (!trimmedData.secretKey || trimmedData.secretKey.length < 28) {
        alert('Secret Access Key must be at least 28 characters long')
        setIsValidating(false)
        return
      }
      
      const response = await fetch('http://localhost:3001/api/aws/validate-credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accessKeyId: trimmedData.accessKey,
          secretAccessKey: trimmedData.secretKey,
          region: trimmedData.region
        }),
      })
      
      const result = await response.json()
      
      if (result.success) {
        onComplete({
          awsCredentials: {
            accessKey: trimmedData.accessKey,
            secretKey: trimmedData.secretKey,
            region: trimmedData.region,
            accountId: result.account
          },
          isValid: true,
          accountInfo: {
            account: result.account,
            userId: result.userId,
            arn: result.arn
          }
        })
      } else {
        // Display the specific error message from the backend
        const errorMessage = result.error || result.message || 'Invalid credentials'
        alert(errorMessage)
        
        // Show additional details in development mode
        if (result.details && process.env.NODE_ENV === 'development') {
          console.error('AWS Validation Error Details:', result.details)
        }
      }
    } catch (error) {
      console.error('AWS credentials validation failed:', error)
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Network error occurred while validating credentials. Please check your connection and try again.'
      alert(errorMessage)
    } finally {
      setIsValidating(false)
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">AWS Credentials</h2>
        <p className="text-gray-600">
          Enter your AWS access credentials to deploy your application to EKS.
        </p>
      </div>

      <form onSubmit={handleSubmit(validateAWSCredentials)} className="space-y-6">
        <div>
          <label htmlFor="accessKey" className="block text-sm font-medium text-gray-700 mb-2">
            AWS Access Key ID
          </label>
          <input
            {...register('accessKey')}
            type="text"
            id="accessKey"
            className="input-field"
            placeholder="AKIAIOSFODNN7EXAMPLE"
          />
          {errors.accessKey && (
            <p className="mt-1 text-sm text-error-600">{errors.accessKey.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="secretKey" className="block text-sm font-medium text-gray-700 mb-2">
            AWS Secret Access Key
          </label>
          <div className="relative">
            <input
              {...register('secretKey')}
              type={showSecretKey ? 'text' : 'password'}
              id="secretKey"
              className="input-field pr-10"
              placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 pr-3 flex items-center"
              onClick={() => setShowSecretKey(!showSecretKey)}
            >
              {showSecretKey ? (
                <EyeSlashIcon className="h-5 w-5 text-gray-400" />
              ) : (
                <EyeIcon className="h-5 w-5 text-gray-400" />
              )}
            </button>
          </div>
          {errors.secretKey && (
            <p className="mt-1 text-sm text-error-600">{errors.secretKey.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="region" className="block text-sm font-medium text-gray-700 mb-2">
            AWS Region
          </label>
          <select
            {...register('region')}
            id="region"
            className="input-field"
          >
            {AWS_REGIONS.map((region) => (
              <option key={region.value} value={region.value}>
                {region.label}
              </option>
            ))}
          </select>
          {errors.region && (
            <p className="mt-1 text-sm text-error-600">{errors.region.message}</p>
          )}
        </div>

        <div className="flex justify-end pt-6">
          <button
            type="submit"
            disabled={!isValid || isValidating}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {isValidating ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Validating...
              </>
            ) : (
              'Continue'
            )}
          </button>
        </div>
      </form>
    </div>
  )
}