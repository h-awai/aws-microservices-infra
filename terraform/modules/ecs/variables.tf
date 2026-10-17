variable "vpc_id" {
  type        = string
  description = "The ID of the VPC"
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "List of public subnet IDs"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "List of private subnet IDs"
}

variable "environment" {
  type        = string
  default     = "prod"
  description = "The environment name"
}

variable "container_image" {
  type        = string
  default     = "nginx:alpine"
  description = "Container image to run"
}
