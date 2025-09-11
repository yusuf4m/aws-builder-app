# AWS Builder App

A web application for automated AWS EKS deployment process with step-by-step configuration.

## Features

### 🔐 AWS Credentials Management
- Secure input for AWS Access Key ID and Secret Access Key
- Region selection with popular AWS regions
- Credential validation before proceeding

### 📦 Repository Integration
- Git repository URL input with validation
- Automatic branch detection and selection
- Docker image building automation
- Integration with AWS ECR for image storage

### 🚀 Deployment Configuration
- **Backend Deployment**: API services with database connectivity, authentication, and monitoring
- **Frontend Deployment**: Static assets, client-side routing, and CDN integration
- Configurable replicas, ports, and resource limits
- Environment variable management
- Health check configuration

### 📊 Deployment Progress Tracking
- Real-time deployment progress monitoring
- Step-by-step execution logs
- Terraform infrastructure provisioning
- Kubernetes application deployment
- Deployment verification and health checks

## Getting Started

### Prerequisites
- Node.js 18+ and npm
- AWS Account with appropriate permissions
- Git repository with Dockerfile
- AWS CLI configured (optional)

### Installation

1. Clone or navigate to the project directory:
   ```bash
   cd /Users/yusufam/Desktop/Corevice/aws-builder-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:3000`

## Usage Guide

### Step 1: AWS Credentials
1. Enter your AWS Access Key ID (minimum 16 characters)
2. Enter your AWS Secret Access Key (minimum 32 characters)
3. Select your preferred AWS region
4. Click "Continue" to validate credentials

### Step 2: Repository Selection
1. Enter your Git repository URL (e.g., `https://github.com/username/repo.git`)
2. Select the branch you want to deploy
3. The system will automatically build a Docker image
4. Wait for the image build process to complete

### Step 3: Deployment Type
1. Choose between **Backend** or **Frontend** deployment:
   - **Backend**: For API services, databases, and server-side applications
   - **Frontend**: For web applications, static sites, and client-side apps
2. Configure deployment settings:
   - Number of replicas (1-10)
   - Application port
   - Environment variables
   - Resource limits

### Step 4: Deploy & Monitor
1. Review your deployment summary
2. Click "Start Deployment" to begin the process
3. Monitor real-time progress through these steps:
   - Terraform initialization
   - Infrastructure planning
   - AWS resource creation
   - Kubernetes configuration
   - Application deployment
   - Deployment verification
4. Access your deployed application via the provided URL

## Integration with EKS Terraform Template

This application integrates with the EKS Terraform template located at:
`/Users/yusufam/Desktop/Corevice/aws-builder-eks/`

The deployment process:
1. Uses the terraform configurations from the EKS template
2. Applies environment-specific variables
3. Creates the necessary AWS infrastructure
4. Deploys your application to the EKS cluster

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Web Interface │────│  Docker Builder  │────│   AWS ECR       │
│   (Next.js)     │    │  (Dockerode)     │    │   (Image Store) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Terraform      │────│   EKS Cluster    │────│   Application   │
│  (Infrastructure)│    │   (Kubernetes)   │    │   (Deployed)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Technology Stack

- **Frontend**: Next.js 14, React 18, TypeScript
- **Styling**: Tailwind CSS
- **Forms**: React Hook Form with Zod validation
- **Icons**: Heroicons
- **Infrastructure**: Terraform, AWS EKS
- **Containerization**: Docker, AWS ECR
- **Deployment**: Kubernetes

## Security Features

- Secure credential input with masked secret keys
- Client-side validation before API calls
- No credential storage in browser
- Environment variable encryption
- AWS IAM integration

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

### Project Structure

```
src/
├── app/
│   ├── globals.css          # Global styles
│   ├── layout.tsx           # Root layout
│   └── page.tsx             # Main deployment wizard
└── components/
    ├── AWSCredentialsStep.tsx      # AWS credentials input
    ├── RepositoryStep.tsx          # Repository selection
    ├── DeploymentTypeStep.tsx      # Deployment configuration
    └── DeploymentProgressStep.tsx  # Progress monitoring
```

## Troubleshooting

### Common Issues

1. **Invalid AWS Credentials**
   - Verify your Access Key ID and Secret Access Key
   - Ensure your AWS account has EKS permissions
   - Check if the selected region is available

2. **Repository Access Issues**
   - Ensure the repository URL is publicly accessible
   - Verify the repository contains a valid Dockerfile
   - Check if the selected branch exists

3. **Deployment Failures**
   - Review the deployment logs for specific errors
   - Ensure sufficient AWS service limits
   - Verify Terraform configurations

### Support

For issues related to:
- **Web Application**: Check browser console and network logs
- **AWS Infrastructure**: Review CloudFormation/Terraform logs
- **Kubernetes**: Use `kubectl` commands to debug

## License

This project is part of the Corevice AWS Builder suite for automated infrastructure deployment.