#!/usr/bin/env node
/**
 * Shared DNS stack — deployed ONCE per AWS account/region.
 * All stages (dev, qa, prod) share a single Route 53 hosted zone and
 * SES domain identity for mucker.io. Deploy with:
 *
 *   npm run deployDns -- --profile <PROFILE>
 */
import "source-map-support/register";
