variable "aws_region" {
  type        = string
  default     = "ap-northeast-1"
  description = "AWS region for deployment"
}

variable "alert_email" {
  type        = string
  default     = "alert-notification@example.com"
  description = "Email address for CloudWatch alarm notifications"
}
