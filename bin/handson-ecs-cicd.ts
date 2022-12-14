#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { InfrastructureStack } from '../lib/infrastructure-stack';
import { FrontendServiceStack } from '../lib/frontend-service-stack';
import { Context } from '../lib/common/context'
import { BackendServiceCrystalStack } from "../lib/backend-service-crystal-stack";

const app = new cdk.App();

const infra = new InfrastructureStack(app, `${Context.ID_PREFIX}-VpcStack`, {
    env: {account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION},
});

new FrontendServiceStack(app, `${Context.ID_PREFIX}-FrontEcsStack`, {
    env: {account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION},
    cluster: infra.cluster,
    frontendServiceSG: infra.frontendServiceSG,
    frontendTaskRole: infra.frontendTaskRole,
    frontendTaskExecutionRole: infra.TaskExecutionRole,
    frontendLogGroup: infra.frontendLogGroup,
    cloudmapNamespace: infra.cloudmapNamespace,
    blueTargetGroup: infra.blueTargetGroup,
    greenTargetGroup: infra.greenTargetGroup,
    frontListener: infra.frontListener,
    frontTestListener: infra.frontTestListener,
});

new BackendServiceCrystalStack(app, `${Context.ID_PREFIX}-BackendCrystalEcsStack`, {
    env: {account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION},
    cluster: infra.cluster,
    backendServiceSG: infra.backendServiceSG,
    backendTaskRole: infra.backendCrystalTaskRole,
    backendTaskExecutionRole: infra.TaskExecutionRole,
    backendLogGroup: infra.backendCrystalLogGroup,
    cloudmapNamespace: infra.cloudmapNamespace,
});
