import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';
import { Context } from './common/context'
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {ApplicationListener} from "aws-cdk-lib/aws-elasticloadbalancingv2/lib/alb/application-listener";

export class InfrastructureStack extends cdk.Stack {
    public readonly cluster: ecs.Cluster;
    public readonly frontendServiceSG: ec2.SecurityGroup;
    public readonly cloudmapNamespace: servicediscovery.PrivateDnsNamespace;
    public readonly frontendTaskRole: iam.Role;
    public readonly TaskExecutionRole: iam.Role;
    public readonly frontendLogGroup: logs.LogGroup;
    public readonly blueTargetGroup: elbv2.ApplicationTargetGroup;
    public readonly greenTargetGroup: elbv2.ApplicationTargetGroup;
    public readonly frontListener: elbv2.ApplicationListener;
    public readonly frontTestListener: elbv2.ApplicationListener;


    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // create a VPC
        const vpc = new ec2.Vpc(this, `${Context.ID_PREFIX}-VPC`, {
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

        // セキュリティグループ(ALB)
        const albSG = new ec2.SecurityGroup(this, `${Context.ID_PREFIX}-ALBSG`, {
            vpc,
            securityGroupName: 'handson-alb-sg',
        })
        albSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80))
        albSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(9000))

        this.frontendServiceSG = new ec2.SecurityGroup(this, `${Context.ID_PREFIX}-FrontendServiceSG`,
            {
                securityGroupName: 'frontendServiceSecurityGroup',
                vpc: vpc,
            }
        );
        this.frontendServiceSG.addIngressRule(albSG, ec2.Port.allTcp());

        // クラウドマップ
        this.cloudmapNamespace = new servicediscovery.PrivateDnsNamespace(this, `${Context.ID_PREFIX}-Namespace`,
            {
                name: `${Context.ID_PREFIX}-service`,
                vpc: vpc,
            }
        );

        // ポリシー
        const ECSExecPolicyStatement = new iam.PolicyStatement({
            sid: `${Context.ID_PREFIX}AllowECSExec`,
            resources: ['*'],
            actions: [
                'ssmmessages:CreateControlChannel', // for ECS Exec
                'ssmmessages:CreateDataChannel', // for ECS Exec
                'ssmmessages:OpenControlChannel', // for ECS Exec
                'ssmmessages:OpenDataChannel', // for ECS Exec
                'logs:CreateLogStream',
                'logs:DescribeLogGroups',
                'logs:DescribeLogStreams',
                'logs:PutLogEvents',
            ],
        });
        this.frontendTaskRole = new iam.Role(this, 'FrontendTaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        });
        this.frontendTaskRole.addToPolicy(ECSExecPolicyStatement);

        this.TaskExecutionRole = new iam.Role(this, `${Context.ID_PREFIX}-TaskExecutionRole`, {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [
                {
                    managedPolicyArn:
                        'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
                },
            ],
        });

        // ロググループ
        this.frontendLogGroup = new logs.LogGroup(this, 'frontendLogGroup', {
            logGroupName: `${Context.ID_PREFIX}-frontend-service`,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Application Load Balancer
        const ecsAlb = new elbv2.ApplicationLoadBalancer(this, `${Context.ID_PREFIX}-ALB`, {
            vpc,
            securityGroup: albSG,
            internetFacing: true,
            loadBalancerName: `${Context.ID_PREFIX}-ALB`,
            vpcSubnets: { subnets: vpc.publicSubnets },
        })

        // Blue リスナー
        this.frontListener = ecsAlb.addListener(`${Context.ID_PREFIX}-Front-Listener`, {
            port: 80,
            open: true,
        })

        // Blue TG
        this.blueTargetGroup = this.frontListener.addTargets(`${Context.ID_PREFIX}-Blue-TargetGroup`, {
            protocol: elbv2.ApplicationProtocol.HTTP,
            port: 3000,
            healthCheck: {
                path: '/health',
            },
        });

        // Green リスナー
        this.frontTestListener = ecsAlb.addListener(`${Context.ID_PREFIX}-FrontTest-Listener`, {
            protocol: elbv2.ApplicationProtocol.HTTP,
            port: 9000,
            open: true,
        })

        // Green TG
        this.greenTargetGroup = this.frontTestListener.addTargets(`${Context.ID_PREFIX}-Green-TargetGroup`, {
            protocol: elbv2.ApplicationProtocol.HTTP,
            port: 3000,
            healthCheck: {
                path: '/health',
            },
        });

        // ECS cluster
        this.cluster = new ecs.Cluster(this, `${Context.ID_PREFIX}-ECSCluster`, {
            vpc: vpc,
            clusterName: 'handson-ecs-cicd-fargate-cluster',
            containerInsights: true,
        });
    }
}