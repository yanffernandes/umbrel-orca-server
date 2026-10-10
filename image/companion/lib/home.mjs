import fs from 'node:fs/promises'
import path from 'node:path'

const SKELETON_FILES = ['.bashrc', '.profile', '.bash_logout']

/**
 * The home directory is an empty bind mount on first start. Give it the usual shell
 * dotfiles and make sure it is writable, since every bit of Orca and agent state
 * lives here.
 */
export async function prepareHome(home) {
  await fs.mkdir(home, { recursive: true })
  try {
    await fs.access(home, fs.constants.W_OK)
  } catch {
    const uid = process.getuid?.() ?? 'unknown'
    throw new Error(
      `${home} is not writable by uid ${uid}. Make the mounted data directory owned by ${uid}.`
    )
  }
  for (const name of SKELETON_FILES) {
    try {
      await fs.copyFile(path.join('/etc/skel', name), path.join(home, name), fs.constants.COPYFILE_EXCL)
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'ENOENT') {
        throw error
      }
    }
  }
  await fs.mkdir(path.join(home, '.local', 'bin'), { recursive: true })
}
