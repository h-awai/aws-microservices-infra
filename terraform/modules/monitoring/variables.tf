variable "ecs_cluster_name" {
  type        = string
  description = "The name of the ECS Cluster to monitor"
}

variable "ecs_service_name" {
  type        = string
  description = "The name of the ECS Service to monitor"
}

variable "environment" {
  type        = string
  default     = "prod"
  description = "The environment name"
}

variable "email_address" {
  type        = string
  default     = "alert-notification@example.com"
  description = "Email address for alert notifications"
}
