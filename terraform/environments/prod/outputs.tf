output "alb_dns_name" {
  value       = module.ecs.alb_dns_name
  description = "The DNS name of the Application Load Balancer"
}
