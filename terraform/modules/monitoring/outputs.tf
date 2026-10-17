output "sns_topic_arn" {
  value       = aws_sns_topic.alerts.arn
  description = "The ARN of the SNS Topic"
}

output "cloudwatch_alarm_arn" {
  value       = aws_cloudwatch_metric_alarm.ecs_cpu_high.arn
  description = "The ARN of the CloudWatch Alarm"
}
