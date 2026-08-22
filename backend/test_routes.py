#!/usr/bin/env python3
import sys
sys.path.insert(0, '/Users/iwugod/www/ivor-mobile/backend')

from main import app
print('App created successfully')
print('Routes with company-brn:')
found = False
for route in app.routes:
    if hasattr(route, 'path'):
        if 'company-brn' in route.path:
            print(f'  FOUND: {route.methods} {route.path}')
            found = True
if not found:
    print('  No company-brn routes found!')

print('\nAll job routes:')
for route in app.routes:
    if hasattr(route, 'path') and ('/job' in route.path):
        print(f'  {route.methods} {route.path}')