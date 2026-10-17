# AWS CI/CD & マイクロサービス基盤 構築ガイド

本リポジトリは、Terraformを使用してAWS上にAmazon ECS (Fargate) をベースにしたWebサービス基盤と、Amazon CloudWatch / SNSを用いた監視基盤を構築し、GitHub Actions (OIDC認証) から自動デプロイを行うための構成管理リポジトリです。

> [!TIP]
> **アーキテクチャ設計判断書（ADR）**
> 「なぜ EKS ではなく ECS Fargate なのか」「なぜ CDK ではなく Terraform なのか」「監視の閾値設計やコストと可用性のトレードオフ」などの詳細な設計思想・判断根拠は、[docs/architecture-decisions.md](file:///C:/Users/awaih/agy2-projects/aws_cicd/docs/architecture-decisions.md) に体系的にまとめています。

---

## セキュリティ設計方針と注意事項

> [!WARNING]
> **IAM最小権限の原則（Least Privilege）に関する設計判断**
> 本リポジトリの初期検証手順では、インフラ全域（VPC, ECS, ALB, CloudWatch, SNS, S3, DynamoDB等）の立ち上げを円滑に行う検証目的の割り切りとして `AdministratorAccess` を例示しています。
> 
> **本番運用においては、必ず最小権限の原則に従い、Terraformが操作するリソースに限定したカスタムポリシーを適用してください。**
> 本リポジトリでは、本番環境向けの最小権限カスタムポリシー定義として [docs/iam-least-privilege-policy.json](file:///C:/Users/awaih/agy2-projects/aws_cicd/docs/iam-least-privilege-policy.json) を同梱しています。

---

## 前提条件

- **AWS CLI** がインストールされ、必要な権限を持つIAMユーザー/ロールで認証されていること。
  - ローカル環境にCLIがない場合は、AWSマネジメントコンソールの **AWS CloudShell**（画面右上にあるターミナルアイコン）から実行することをお勧めします。

---

## 初期リソースの作成手順

GitHub Actionsが動作する前に、状態管理（Terraform State）用のS3バケット/DynamoDB、およびGitHub OIDC用のIAMロールを作成する必要があります。

### 1. Terraform State管理用 S3バケットの作成
Terraformの状態（State）ファイルを安全に格納するためのS3バケットを作成し、ファイルの履歴管理（バージョニング）を有効化します。

```bash
# S3バケットの作成 (東京リージョン) - バケット名は世界でユニークな名前に置き換えてください
aws s3api create-bucket \
  --bucket <YOUR_UNIQUE_PREFIX>-terraform-state-prod \
  --region ap-northeast-1 \
  --create-bucket-configuration LocationConstraint=ap-northeast-1

# バージョニングの有効化
aws s3api put-bucket-versioning \
  --bucket <YOUR_UNIQUE_PREFIX>-terraform-state-prod \
  --versioning-configuration Status=Enabled
```

### 2. Terraform Stateロック用 DynamoDBテーブルの作成
複数メンバーやパイプラインが同時にTerraformを実行してStateが破損するのを防ぐため、ロック管理用のDynamoDBテーブルを作成します。

```bash
aws dynamodb create-table \
  --table-name terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-northeast-1
```

### 3. AWS IAM OIDC プロバイダーの作成 (未作成の場合のみ)
AWSアカウントでGitHub Actionsからの認証を許可するためのOIDC IDプロバイダーを登録します。すでに登録済みの場合は、この手順はスキップしてください。

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

### 4. GitHub Actions用 IAMロールの作成
GitHub ActionsがAWS APIを安全に呼び出す際に使用するIAMロールを作成します。
事前に [docs/trust-policy.json](file:///C:/Users/awaih/agy2-projects/aws_cicd/docs/trust-policy.json) 内の `<YOUR_ACCOUNT_ID>` および `<YOUR_GITHUB_USER>/<YOUR_GITHUB_REPO>` をご自身の値に置き換えてください。

```bash
# 信頼ポリシー(docs/trust-policy.json)を使用してロールを作成
aws iam create-role \
  --role-name github-actions-terraform-role \
  --assume-role-policy-document file://docs/trust-policy.json
```

### 5. IAMロールへの権限付与

#### A. 本番環境推奨：最小権限カスタムポリシーの適用
Terraformが操作するリソースのみに限定したポリシー [docs/iam-least-privilege-policy.json](file:///C:/Users/awaih/agy2-projects/aws_cicd/docs/iam-least-privilege-policy.json) を作成してアタッチします。

```bash
# カスタムポリシーの作成
aws iam create-policy \
  --policy-name TerraformDeploymentLeastPrivilegePolicy \
  --policy-document file://docs/iam-least-privilege-policy.json

# ロールへアタッチ
aws iam attach-role-policy \
  --role-name github-actions-terraform-role \
  --policy-arn arn:aws:iam::<YOUR_ACCOUNT_ID>:policy/TerraformDeploymentLeastPrivilegePolicy
```

#### B. 検証・学習環境用（簡易立ち上げ）：AdministratorAccess
※検証目的で迅速に動作確認を行う場合のみ利用してください。

```bash
aws iam attach-role-policy \
  --role-name github-actions-terraform-role \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

---

## GitHub Secretsの登録

初期リソースの作成が完了したら、GitHub Actionsから作成したIAMロールを使用できるようにSecretsを登録します。

1. GitHub上の対象リポジトリにアクセスします。
2. **Settings** > **Secrets and variables** > **Actions** に移動します。
3. **New repository secret** をクリックし、以下を登録します。
   - **Name**: `AWS_ROLE_ARN`
   - **Value**: `arn:aws:iam::<YOUR_ACCOUNT_ID>:role/github-actions-terraform-role`

---

## 開発とデプロイの流れ

1. `terraform/` 配下の構成ファイルを修正します。
2. 修正内容を新しいブランチにコミットし、Pull Requestを作成します。
   - GitHub Actionsが自動的に起動し、`terraform plan` を実行して差分を出力します。
3. 差分を確認し、PRを `main` ブランチにマージします。
   - GitHub Actionsが自動的に `terraform apply` を実行し、実際のAWS環境へ安全に反映されます。
