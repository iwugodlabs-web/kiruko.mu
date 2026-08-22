import sys

file_path = '/Users/iwugod/www/ivor-mobile/web/ivor-web/src/app/dashboard/components/CompanyUsersSection.tsx'
with open(file_path, 'r') as f:
    content = f.read()

content = content.replace(
    '{showInvite && <InviteUserModal onClose={() => setShowInvite(false)} onInvite={handleInvite} />}',
    '{showInvite && <InviteUserModal isOpen={showInvite} onClose={() => setShowInvite(false)} onInvite={handleInvite} />}'
)

with open(file_path, 'w') as f:
    f.write(content)
