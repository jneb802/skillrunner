#!/usr/bin/env bun
import React from 'react'
import { render } from 'ink'
import { App } from './App.js'

const repoPath = process.cwd()

const { waitUntilExit } = render(<App repoPath={repoPath} />)
await waitUntilExit()
