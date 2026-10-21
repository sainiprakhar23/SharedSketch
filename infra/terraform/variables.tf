variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Deployment environment name"
  type        = string
  default     = "lab"
}

variable "instance_type" {
  description = "EC2 instance size. Default is t3.micro (AWS Free Tier eligible: 750 hrs/month). A 4GB swapfile is automatically configured on the host to ensure stability."
  type        = string
  default     = "t3.micro"

  validation {
    condition     = contains(["t2.micro", "t3.micro", "t3.small", "t3.medium"], var.instance_type)
    error_message = "Instance type must be Free Tier or low-cost (t2.micro, t3.micro, t3.small, t3.medium)."
  }
}

variable "root_volume_size" {
  description = "EBS root volume size in GB. Set to 30 GB to stay strictly within the AWS Free Tier limit (up to 30 GB free per month)."
  type        = number
  default     = 30
}

variable "root_volume_type" {
  description = "EBS root volume type"
  type        = string
  default     = "gp3"
}

variable "ecr_repository_name" {
  description = "Name of the Amazon ECR repository"
  type        = string
  default     = "sharedsketch"
}

variable "trusted_ssh_cidr" {
  description = "Optional trusted IP CIDR for SSH access (e.g. 203.0.113.50/32). Leave empty to disable direct SSH and rely exclusively on AWS SSM Session Manager."
  type        = string
  default     = ""
}

variable "ssh_key_name" {
  description = "Optional EC2 Key Pair name if direct SSH is enabled. Leave empty if using SSM Session Manager."
  type        = string
  default     = ""
}
