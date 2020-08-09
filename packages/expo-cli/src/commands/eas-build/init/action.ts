import chalk from 'chalk';
import figures from 'figures';
import fs from 'fs-extra';
import ora from 'ora';
import path from 'path';

import { EasConfig, EasJsonReader } from '../../../easJson';
import log from '../../../log';
import AndroidBuilder from '../build/builders/AndroidBuilder';
import iOSBuilder from '../build/builders/iOSBuilder';
import { BuildCommandPlatform } from '../types';
import createBuilderContextAsync from '../utils/createBuilderContextAsync';
import {
  DirtyGitTreeError,
  ensureGitStatusIsCleanAsync,
  reviewAndCommitChangesAsync,
} from '../utils/git';

interface BuildOptions {
  platform: BuildCommandPlatform;
  skipCredentialsCheck?: boolean; // TODO: noop for now
  profile: string;
  parent?: {
    nonInteractive: boolean;
  };
}

async function initAction(projectDir: string, options: BuildOptions): Promise<void> {
  const platforms = Object.values(BuildCommandPlatform);

  const { platform = BuildCommandPlatform.ALL, profile } = options;

  if (!platforms.includes(platform)) {
    throw new Error(
      `-p/--platform needs a valid platform: ${platforms.map(p => log.chalk.bold(p)).join(', ')}`
    );
  }

  const spinner = ora('Creating minimal eas.json file');

  ensureGitStatusIsCleanAsync();

  const easConfig: EasConfig = await new EasJsonReader(projectDir, platform).readAsync(profile);
  const ctx = await createBuilderContextAsync(projectDir, easConfig, {
    platform,
    nonInteractive: options.parent?.nonInteractive,
    skipCredentialsCheck: options?.skipCredentialsCheck,
    skipProjectConfiguration: false,
  });

  const easJsonPath = path.join(projectDir, 'eas.json');
  const easJson = {
    builds: {
      android: {
        [profile]: {
          workflow: 'generic',
        },
      },
      ios: {
        [profile]: {
          workflow: 'generic',
        },
      },
    },
  };

  if (!(await fs.pathExists(easJsonPath))) {
    await fs.writeFile(easJsonPath, JSON.stringify(easJson, null, 2));
  }

  try {
    await ensureGitStatusIsCleanAsync();
    spinner.succeed();
  } catch (err) {
    if (err instanceof DirtyGitTreeError) {
      spinner.succeed('We created a minimal eas.json file');
      log.newLine();

      try {
        await reviewAndCommitChangesAsync('Create minimal eas.json', {
          nonInteractive: ctx.nonInteractive,
        });

        log(`${chalk.green(figures.tick)} Successfully committed eas.json.`);
      } catch (e) {
        throw new Error(
          "Aborting, run the command again once you're ready. Make sure to commit any changes you've made."
        );
      }
    } else {
      spinner.fail();
      throw err;
    }
  }

  if ([BuildCommandPlatform.ANDROID, BuildCommandPlatform.ALL].includes(ctx.platform)) {
    const builder = new AndroidBuilder(ctx);

    await builder.configureProjectAsync();
  }
  if ([BuildCommandPlatform.IOS, BuildCommandPlatform.ALL].includes(ctx.platform)) {
    const builder = new iOSBuilder(ctx);

    await builder.ensureCredentialsAsync();
    await builder.configureProjectAsync();
  }
}

export default initAction;
