# システムアーキテクチャ設計判断書 (Architecture Decision Record)

本ドキュメントは、本リポジトリで採用しているクラウドインフラ、CI/CDパイプライン、および監視基盤の**技術選定理由、トレードオフ、および設計思想**を記録したものです。

単に「動作するコード」を提供するだけでなく、実務およびエンタープライズ視点で「なぜこの構成を選択したのか」「どのようなリスクをどう制御しているのか」を明確にすることを目的としています。

---

## 1. 全体アーキテクチャ概要

本システムは、セキュアなCI/CDパイプライン（OIDC認証）を起点に、コンテナ実行環境（Amazon ECS Fargate）、分散データベース（Amazon DynamoDB）、統合監視（CloudWatch / SNS）、およびランサムウェア対策としてのイミュータブルバックアップ（S3 Object Lock / AWS Backup Vault Lock）で構成されています。

```mermaid
flowchart TD
    subgraph CI/CD [CI/CD パイプライン (GitHub Actions)]
        GHA[GitHub Actions Runner]
        OIDC[AWS STS AssumeRoleWithWebIdentity]
        GHA -->|1. OIDC認証 / 短期認証情報取得| OIDC
    end

    subgraph AWS_Cloud [AWS クラウド環境 (ap-northeast-1)]
        IAM_Role[GitHub Actions用 IAMロール]
        OIDC -->|2. 権限委任| IAM_Role
        IAM_Role -->|3. Terraform Plan / Apply| TF_Deploy[インフラ自動反映]

        subgraph Network [VPC (2AZ 高可用性)]
            ALB[Application Load Balancer]
            
            subgraph ECS_Cluster [Amazon ECS クラスター]
                Fargate1[ECS Fargate タスク (AZ-1a)]
                Fargate2[ECS Fargate タスク (AZ-1c)]
            end
            
            ALB -->|HTTP/HTTPS 転送| Fargate1
            ALB -->|HTTP/HTTPS 転送| Fargate2
        end

        subgraph Database [データベース & ストレージ]
            DDB_Inventory[(DynamoDB: 在庫テーブル)]
            DDB_Sales[(DynamoDB: 売上テーブル)]
            Fargate1 & Fargate2 --> DDB_Inventory
            Fargate1 & Fargate2 --> DDB_Sales
        end

        subgraph Monitoring [監視 & オブザーバビリティ]
            CW_Logs[CloudWatch Logs (コンテナログ)]
            CW_Alarm[CloudWatch Alarms (CPU 80% 2期間)]
            SNS[SNS トピック (アラート通知)]
            
            Fargate1 & Fargate2 -.->|ログストリーム| CW_Logs
            ECS_Cluster -.->|メトリクス監視| CW_Alarm
            CW_Alarm -->|アラート発報| SNS
        end

        subgraph Ransomware_Defense [イミュータブルバックアップ (ランサムウェア対策)]
            S3_Lock[S3 バケット (Object Lock / WORM保護)]
            Backup_Vault[AWS Backup Vault Lock (コンプライアンスモード)]
            
            DDB_Inventory & DDB_Sales -->|日次自動保護| Backup_Vault
        end
    end

    subgraph On_Premises [オンプレミス / ローカル拠点 (個人情報完全分離)]
        Local_DB[(顧客個人情報 DB)]
        Local_Client[クライアント / 管理端末]
        
        Local_Client -->|AWS売上UUIDとローカル顧客情報をメモリ結合| Local_DB
        Local_Client -->|API経由でアクセス| ALB
    end
```

---

## 2. 主要な設計判断 (Design Decisions)

### 判断 1: なぜ EKS ではなく ECS Fargate なのか？

| 比較項目 | Amazon EKS | Amazon ECS on Fargate (本構成) |
| :--- | :--- | :--- |
| **コントロールプレーン費用** | 月額 約 $73 (固定費) | **$0 (無料)** |
| **運用・保守負荷** | 極めて高い (K8sの年3回バージョン追従、アドオン更新、ノード管理) | **極めて低い (OS・ノード・クラスターのパッチ当て不要)** |
| **AWS親和性** | IAM、CloudWatchとの連携にアドオンや追加設定が必要 | **IAM Role、awsvpc、CloudWatch Logsとネイティブ統合** |
| **適した組織フェーズ** | K8s専任インフラチームがあり、数十〜数百マイクロサービスを運用 | **少人数〜中規模で、アプリ開発に注力したい実務環境** |

#### 【選定理由】
- **運用負荷とトータルコスト（TCO）の最適化**: EKSは柔軟である反面、クラスター基本料金（約$73/月）に加えてノード管理や3ヶ月ごとのバージョンアップ追従など、多大な運用コストが発生します。本システムでは、インフラ保守負荷をゼロに近づけ、開発者がアプリケーション価値に集中できるよう **ECS Fargate** を採用しました。
- **セキュリティと分離性**: Fargateはタスクごとに完全に分離されたマイクロVMで動作するため、マルチテナント環境におけるコンテナ間エスケープのリスクを原理的に遮断できます。

---

### 判断 2: なぜ AWS CDK ではなく Terraform なのか？

| 比較項目 | AWS CDK | Terraform (HCL) (本構成) |
| :--- | :--- | :--- |
| **記述方式** | 命令的・プログラミング言語 (TypeScript, Python等) | **純粋な宣言的言語 (HCL: HashiCorp Configuration Language)** |
| **差分予測 (Plan)** | CloudFormationスタック生成を通すため、実環境との差分が見えにくい場合がある | **`terraform plan` により、実行前にAPIレベルで厳密な変更差分を100%確認可能** |
| **マルチクラウド対応** | AWS専用 (他クラウドはCDK8sやCDKTF等で分断) | **AWS, GitHub, Cloudflare, Datadog等を単一構文・単一Stateで一元管理可能** |
| **実務エコシステム** | 採用企業が増加中だが、抽象化（L2/L3コンストラクト）のブラックボックス化懸念 | **世界的なデファクトスタンダードであり、コードレビューが容易** |

#### 【選定理由】
- **`terraform plan` による確実な安全性**: コードの実行前に「どのリソースが追加され、どれが破棄（destroy）されるか」が明確に可視化される宣言的アプローチは、CI/CDパイプラインにおいて最も事故を防ぎやすい設計です。
- **GitHubリソースとの親和性**: 本構成では将来的にGitHub ActionsのSecretsやリポジトリ設定も同一IaCで管理可能な拡張性を持たせるため、マルチプロバイダー対応のTerraformを選択しました。

---

### 判断 3: 監視・オブザーバビリティの設計思想

監視において最も避けるべきは「アラートの形骸化（狼少年化）」です。本アーキテクチャでは以下の明確な境界線を設けています。

1. **アラート（即時アクションが必要なもの）**:
   - **対象**: `CPUUtilization >= 80%` (2期間連続: 合計2分間)
   - **通知先**: SNS経由で即座に担当者・オンコールへ通知。
   - **閾値の根拠**:
     - 単発のスパイク（バッチ処理や起動時の初期化）で誤発報しないよう、`evaluation_periods = 2`（2回連続）を設定。
     - 80%に達した段階で通知することで、サービス停止（100%枯渇）に至る前にオートスケーリングの稼働確認やタスク追加の初動対応を行う**時間的猶予（バッファ）**を確保しています。
2. **ログ（事後調査・監査のためのもの）**:
   - **対象**: コンテナの標準出力・標準エラー出力（`awslogs` ドライバー経由）。
   - **保持ポリシー**: CloudWatch Logs の保持期間を `7日〜30日` に限定。無制限保存による意図しないストレージ課金を防止。

---

### 判断 4: コストと可用性のトレードオフ設計

実務の設計では、「可用性を上げればコストが増加し、コストを削れば障害リスクが増加する」というトレードオフのバランスをどこに置くかが問われます。

```
【本番商用環境 (High Availability)】
  マルチAZ NAT Gateway 2台 ($90/月) ＋ ALB ($24/月) ＋ マルチタスク ＝ 月額 $120〜$150超
        ▲
        │ 本構成のバランス調整
        ▼
【本リポジトリの検証・初期構成 (Cost-Optimized)】
  シングルNAT Gateway または パブリック配置 ＋ Desired Count=1〜2 ＝ 月額を約半分以下に圧縮
```

- **ネットワーク構成の判断**:
  - 本番環境ではECSタスクを完全なプライベートサブネットに配置し、マルチAZのNAT Gatewayを経由させるのが鉄則です。
  - しかし、個人検証やステージング環境ではNAT Gateway（1台あたり約$45/月）が最大の固定費となります。そのため、検証用テンプレート（CloudFormation等）ではパブリックサブネットへの配置オプションを用意し、セキュリティグループでALBからのインバウンドのみに厳格に制限することで、**安全性を担保したまま大幅なコストカット**を実現できる構成としています。

---

### 判断 5: ランサムウェア対策と個人情報保護のハイブリッド設計

1. **イミュータブルバックアップ (WORM: Write Once, Read Many)**:
   - AWSアカウントのルート権限や管理者権限が奪取された場合でも、**AWS Backup Vault Lock（コンプライアンスモード）** および **S3 Object Lock** を適用することで、保持期間が経過するまでいかなる権限（AWSサポート含む）でもバックアップの削除や改ざんを不可能にしています。
2. **顧客データ（PII: 個人特定可能情報）のローカル分離**:
   - AWS上には売上・在庫データのみを保持し、顧客の個人情報はローカル環境（オンプレミス）のデータベースで管理します。
   - AWS側の売上レコードにはランダム生成された `customer_uuid` のみを記録（仮名化）することで、万が一AWS環境が完全侵害・データ流出に遭った場合でも、**個人情報の漏洩を物理的にゼロ**に抑え込むゼロトラスト設計を採用しています。

---

## 3. 本番商用化に向けた移行ロードマップ

本リポジトリの構成を商用本番環境へ昇格させる場合、以下のステップを順次適用します。

| フェーズ | 移行項目 | 具体的な実施内容 |
| :--- | :--- | :--- |
| **Phase 1** | **IAM最小権限化** | `AdministratorAccess` を完全廃止し、[docs/iam-least-privilege-policy.json](file:///C:/Users/awaih/agy2-projects/aws_cicd/docs/iam-least-privilege-policy.json) に基づく専用ポリシーをGitHub Actionsに適用。 |
| **Phase 2** | **シークレット管理** | 環境変数に含まれる機密情報を **AWS Secrets Manager** または **SSM Parameter Store** に移行し、KMS CMK（カスタマー管理キー）で暗号化。 |
| **Phase 3** | **ネットワーク完全隔離** | ECSタスクをプライベートサブネットへ移行し、各AZごとに冗長化されたNAT GatewayおよびAWS VPCエンドポイント（S3, ECR, CloudWatch）を配置。 |
| **Phase 4** | **WAF & エッジ保護** | ALBの前段に **AWS WAF** および **Amazon CloudFront** を配置し、DDoS攻撃やSQLインジェクション等のWebレイヤー攻撃を防御。 |
| **Phase 5** | **マルチアカウント構成** | AWS Organizationsを採用し、「本番アカウント」「検証アカウント」「イミュータブルバックアップ専用隔離アカウント」を分離。 |
