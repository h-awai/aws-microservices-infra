variable "vpc_cidr" {
  type        = string
  default     = "10.0.0.0/16"
  description = "The CIDR block for the VPC"
}

variable "environment" {
  type        = string
  default     = "prod"
  description = "The environment name"
}
