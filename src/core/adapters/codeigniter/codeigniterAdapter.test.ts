import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findCodeIgniterRoutes } from './codeigniterAdapter'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixture(routes: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-ci-routes-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'app', 'Config'), { recursive: true })
  fs.mkdirSync(path.join(root, 'app', 'Controllers', 'Admin'), { recursive: true })
  fs.mkdirSync(path.join(root, 'app', 'Views', 'admin', 'admin_accounts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'app', 'Config', 'Routes.php'), routes)
  fs.writeFileSync(path.join(root, 'app', 'Controllers', 'Admin', 'AdminAccounts.php'), `<?php
    namespace App\\Controllers\\Admin;
    class AdminAccounts { public function index() { return view('admin/admin_accounts/index'); } }
  `)
  fs.writeFileSync(path.join(root, 'app', 'Views', 'admin', 'admin_accounts', 'index.php'), '<h1>Admin accounts</h1>')
  return root
}

describe('CodeIgniter route discovery', () => {
  test('discovers routes inside a group with options before the closure', () => {
    const root = fixture(`<?php
      $routes->group('admin', ['filter' => 'admin'], static function ($routes) {
        $routes->get('admin-accounts', 'Admin\\AdminAccounts::index');
      });
    `)

    expect(findCodeIgniterRoutes(root)).toEqual([
      expect.objectContaining({
        name: 'Admin Accounts',
        filePath: 'app/Views/admin/admin_accounts/index.php',
        route: '/admin/admin-accounts',
      }),
    ])
  })

  test('still supports a group whose closure is the second argument', () => {
    const root = fixture(`<?php
      $routes->group('admin', static function ($routes) {
        $routes->get('admin-accounts', 'Admin\\AdminAccounts::index');
      });
    `)

    expect(findCodeIgniterRoutes(root)[0]?.route).toBe('/admin/admin-accounts')
  })
})
