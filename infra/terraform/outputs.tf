output "aws_region" {
  description = "Target AWS region"
  value       = var.aws_region
}

output "ec2_instance_id" {
  description = "EC2 Instance ID of the K3s and Jenkins host"
  value       = aws_instance.host.id
}

output "ec2_public_ip" {
  description = "Public IPv4 address of the EC2 host (Application HTTP/HTTPS)"
  value       = aws_instance.host.public_ip
}

output "ecr_repository_url" {
  description = "Amazon ECR Repository URL for versioned Docker images"
  value       = aws_ecr_repository.app.repository_url
}

output "ssm_connect_command" {
  description = "Command to establish an encrypted shell session using AWS Systems Manager"
  value       = "aws ssm start-session --target ${aws_instance.host.id} --region ${var.aws_region}"
}
