module "vpc" {
  source      = "../../modules/vpc"
  environment = "prod"
  vpc_cidr    = "10.0.0.0/16"
}

module "ecs" {
  source             = "../../modules/ecs"
  environment        = "prod"
  vpc_id             = module.vpc.vpc_id
  public_subnet_ids  = module.vpc.public_subnet_ids
  private_subnet_ids = module.vpc.private_subnet_ids
  container_image    = "bsord/tetris"
}

module "monitoring" {
  source           = "../../modules/monitoring"
  environment      = "prod"
  ecs_cluster_name = module.ecs.ecs_cluster_name
  ecs_service_name = module.ecs.ecs_service_name
  email_address    = var.alert_email
}
