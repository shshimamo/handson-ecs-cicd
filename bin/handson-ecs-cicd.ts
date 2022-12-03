#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { HandsonEcsCicdStack } from '../lib/handson-ecs-cicd-stack';

const app = new cdk.App();
new HandsonEcsCicdStack(app, 'HandsonEcsCicdStack', {
    env: {account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION},
});