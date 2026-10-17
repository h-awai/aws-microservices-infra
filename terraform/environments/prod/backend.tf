terraform {
  backend "s3" {
    bucket         = "my-terraform-state-prod-<YOUR_ACCOUNT_ID>"
    key            = "prod/terraform.tfstate"
    region         = "ap-northeast-1"
    dynamodb_table = "terraform-locks"
  }
}
