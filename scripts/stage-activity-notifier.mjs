#!/usr/bin/env node
// Fixed notification resources for the Windows SEA and portable JS packages.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const [source, destination, ...extra] = process.argv.slice(2)
if (!source || !destination || extra.length) throw new Error('usage: stage-activity-notifier.mjs companion-root package-root')
const resolve = createRequire(path.resolve(source, 'package.json'))
const vendor = path.join(path.dirname(resolve.resolve('node-notifier/package.json')), 'vendor', 'snoreToast')
const names = ['snoretoast-x64.exe', 'snoretoast-x86.exe', 'LICENSE']
// Validate the complete set before touching the output; never ship a missing helper.
for (const name of names) if (!fs.statSync(path.join(vendor, name)).isFile()) throw new Error('Missing activity notification resource: ' + name)
const output = path.resolve(destination, 'activity-bin')
fs.mkdirSync(output, { recursive: true })
for (const name of names) fs.copyFileSync(path.join(vendor, name), path.join(output, name))
