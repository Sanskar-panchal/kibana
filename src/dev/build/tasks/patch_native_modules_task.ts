/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import path from 'path';

import { ToolingLog } from '@kbn/tooling-log';

import {
  deleteAll,
  downloadToDisk,
  gunzip,
  untar,
  Task,
  Config,
  Build,
  Platform,
  read,
} from '../lib';

const DOWNLOAD_DIRECTORY = '.native_modules';

interface Package {
  name: string;
  version: string;
  destinationPath: string;
  extractMethod: string;
  archives: Record<
    string,
    {
      url: string;
      sha256: string;
    }
  >;
}

const packages: Package[] = [
  {
    // Tip: use `scripts/download_re2.sh` to download binary artifacts from GitHub
    name: 're2',
    version: '1.20.9',
    destinationPath: 'node_modules/re2/build/Release/re2.node',
    extractMethod: 'gunzip',
    archives: {
      'linux-x64': {
        url: 'https://us-central1-elastic-kibana-184716.cloudfunctions.net/kibana-ci-proxy-cache/node-re2/uhop/node-re2/releases/download/1.20.9/linux-x64-108.gz',
        sha256: '136b6cf61b54bf610071a950400518add65d44a4923f11ef658769df1a037f0b',
      },
      // Linux ARM builds are currently done manually as Github Actions used in upstream project
      // do not natively support an Linux ARM target.
      //
      // From an AWS Graviton instance running Ubuntu or a GCE T2A instance running Debian:
      // * install build-essential package: `sudo apt-get update` + `sudo apt install build-essential`
      // * install nvm and the node version used by the Kibana repository
      // * `npm install re2@1.17.7`
      // * re2 will build itself on install
      // * `cp node_modules/re2/build/Release/re2.node linux-arm64-$(node -e "console.log(process.versions.modules)")`
      // * `gzip linux-arm64-*`
      // * capture the sha256 with: `shasum -a 256 linux-arm64-*`
      // * upload the `linux-arm64-*.gz` artifact to the `yarn-prebuilt-artifacts` bucket in GCS using the correct version number
      'linux-arm64': {
        url: 'https://us-central1-elastic-kibana-184716.cloudfunctions.net/kibana-ci-proxy-cache/node-re2/uhop/node-re2/releases/download/1.20.9/linux-arm64-108.gz',
        sha256: '311822ac689bd49a534ecf400b4732a288ad218f711b0e593e41dd3a6b739d97',
      },
      'darwin-x64': {
        url: 'https://us-central1-elastic-kibana-184716.cloudfunctions.net/kibana-ci-proxy-cache/node-re2/uhop/node-re2/releases/download/1.20.9/darwin-x64-108.gz',
        sha256: '215b6ffb1e5d124439a7dbdd09e4ed1263e065839354a6ad67091ce00d14ee9b',
      },
      'darwin-arm64': {
        url: 'https://us-central1-elastic-kibana-184716.cloudfunctions.net/kibana-ci-proxy-cache/node-re2/uhop/node-re2/releases/download/1.20.9/darwin-arm64-108.gz',
        sha256: '0a8bc28150c9efd04f3b52ac214cc7898bde1b8e1f8e6900ae711b03665ff657',
      },
      'win32-x64': {
        url: 'https://us-central1-elastic-kibana-184716.cloudfunctions.net/kibana-ci-proxy-cache/node-re2/uhop/node-re2/releases/download/1.20.9/win32-x64-108.gz',
        sha256: '117872144e4a2bb61611aacc51ac9fd24e494c209cf63366f236099a662316eb',
      },
    },
  },
];

async function getInstalledVersion(config: Config, packageName: string) {
  const packageJSONPath = config.resolveFromRepo(
    path.join('node_modules', packageName, 'package.json')
  );
  const json = await read(packageJSONPath);
  const packageJSON = JSON.parse(json);
  return packageJSON.version;
}

async function patchModule(
  config: Config,
  log: ToolingLog,
  build: Build,
  platform: Platform,
  pkg: Package
) {
  const installedVersion = await getInstalledVersion(config, pkg.name);
  if (installedVersion !== pkg.version) {
    throw new Error(
      `Can't patch ${pkg.name}'s native module, we were expecting version ${pkg.version} and found ${installedVersion}`
    );
  }
  const platformName = platform.getNodeArch();
  const archive = pkg.archives[platformName];
  const archiveName = path.basename(archive.url);
  const downloadPath = config.resolveFromRepo(DOWNLOAD_DIRECTORY, pkg.name, archiveName);
  const extractPath = build.resolvePathForPlatform(platform, pkg.destinationPath);
  log.debug(`Patching ${pkg.name} binaries from ${archive.url} to ${extractPath}`);

  await deleteAll([extractPath], log);
  await downloadToDisk({
    log,
    url: archive.url,
    destination: downloadPath,
    shaChecksum: archive.sha256,
    shaAlgorithm: 'sha256',
    maxAttempts: 3,
  });
  switch (pkg.extractMethod) {
    case 'gunzip':
      await gunzip(downloadPath, extractPath);
      break;
    case 'untar':
      await untar(downloadPath, extractPath);
      break;
    default:
      throw new Error(`Extract method of ${pkg.extractMethod} is not supported`);
  }
}

export const PatchNativeModules: Task = {
  description: 'Patching platform-specific native modules',
  async run(config, log, build) {
    for (const pkg of packages) {
      await Promise.all(
        config.getTargetPlatforms().map(async (platform) => {
          await patchModule(config, log, build, platform, pkg);
        })
      );
    }
  },
};
