import * as cdk from 'aws-cdk-lib';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class HandsonEcsCicdStack extends cdk.Stack {
  readonly userName = 'handsonEcsCicd'

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // create a VPC
    const vpc = new ec2.Vpc(this, 'VPC', {
      cidr: '10.0.0.0/16',
      maxAzs: 3,
      subnetConfiguration: [
        {
          // PublicSubnet
          cidrMask: 24,
          name: 'ingress',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    // create a security group
    const handsonAlbSg = new ec2.SecurityGroup(this, 'handson-alb-sg', {
      vpc,
      description: 'ALB SG of handson-ecs-cicd-stack',
      securityGroupName: 'handson-alb-sg',
    })
    handsonAlbSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80))
    handsonAlbSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(9000))

    // Application Load Balancer
    const ecsAlb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      securityGroup: handsonAlbSg,
      internetFacing: true, // インターネット向け
      loadBalancerName: 'ALB',
    })

    // ECS cluster
    const cluster = new ecs.Cluster(this, 'ECSCluster', {
      vpc: vpc,
      clusterName: 'handson-ecs-cicd-fargate-cluster',
      containerInsights: true,
    });

    /*
     ECS フロントエンドタスク定義
     */
    const frontTaskDefinition = new ecs.FargateTaskDefinition(this, `${this.userName}-ecsdemo-frontend`, {
      memoryLimitMiB: 512,
      cpu: 256,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
      },
    });
    const frontRepo = ecr.Repository.fromRepositoryArn(
        this,
        "front-repo",
        "arn:aws:ecr:ap-northeast-1:449974608116:repository/devday2019-ecsdemo-frontend"
    )
    const frontContainer = frontTaskDefinition.addContainer('frontContainer', {
      containerName: 'ecsdemo-frontend',
      image: ecs.ContainerImage.fromEcrRepository(frontRepo),
      memoryLimitMiB: 512,
      cpu: 256,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: this.userName,
      }),
      portMappings: [
        {
          containerPort: 3000,
          hostPort: 3000,
        },
      ],
      environment: {
        'CRYSTAL_URL': `http://${this.userName}-ecsdemo-crystal.service:3000/crystal`,
        'NODEJS_URL': `http://${this.userName}-ecsdemo-nodejs.service:3000`
      },
    });

    // Create ECS service
    const frontService = new ecs.FargateService(this, 'FrontService', {
      cluster: cluster,
      taskDefinition: frontTaskDefinition,
      desiredCount: 3,
      serviceName: `${this.userName}-ecsdemo-frontend`,
      assignPublicIp: true,
      deploymentController: {
        type: ecs.DeploymentControllerType.CODE_DEPLOY,
      },
    });

    const frontListener = ecsAlb.addListener('FrontListener', {
      port: 80,
      open: true,
    })

    const frontTestListener = ecsAlb.addListener('FrontTestListener', {
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 9000,
      open: true,
    })

    // Blue Group
    const blueTargetGroup = frontListener.addTargets('BlueTargetGroup', {
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 3000,
      targets: [frontService],
      healthCheck: {
        path: '/health',
      },
    });

    // Green Group
    const greenTargetGroup = new elbv2.ApplicationTargetGroup(this, 'GreenTargetGroup', {
      vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
      },
    })

    frontListener.addTargetGroups(`${this.userName}BlueTG`, {
      targetGroups: [blueTargetGroup],
    })
    frontTestListener.addTargetGroups(`${this.userName}GreenTG`, {
      targetGroups: [greenTargetGroup],
    })

    // CodeDeployのECSアプリケーションを作成
    const ecsApplication = new codedeploy.EcsApplication(this, 'EcsApplication', {
      applicationName: 'FrontECSService', // 名称は任意
    });

    // v2.50.0より後（L2 Costruct）
    const blueGreenDeploymentGroup = new codedeploy.EcsDeploymentGroup(this, 'BlueGreenDeploymentGroup', {
      blueGreenDeploymentConfig: {  // ターゲットグループやリスナーを直接設定
        blueTargetGroup,
        greenTargetGroup,
        listener: frontListener,
        testListener: frontTestListener
      },
      autoRollback: {  // ロールバックの設定
        failedDeployment: true
      },
      service: frontService,  // ECSサービスを直接指定
      application: ecsApplication,  // 2で作成したECSアプリケーション
      deploymentConfig: codedeploy.EcsDeploymentConfig.ALL_AT_ONCE, // デプロイの方式を指定（一括で置き換えるのか、一定割合ずつ置き換えるのかなど）
      deploymentGroupName: 'frontEcsDeployment',
    })

    /*
     */
  }
}
