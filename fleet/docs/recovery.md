# Rebuild or recover MS-A2

1. Before touching disks, ensure backups are available off the machine.
   Ansible is configuration management, not a data backup.
2. Keep an offline, tested copy of your SSH private key on the Mac.
   Store machine/application secrets outside this public repository.
3. After installing fresh Ubuntu with OpenSSH, verify login locally and
   from the Mac before running Fleet.
4. Clone Fleet, run ./fleet/bin/fleet bootstrap ms-a2, then authorize
   Tailscale from the console using sudo tailscale up.
5. Restore encrypted application data and Docker volumes from backups
   only after the machine is back online. Verify restore with a test.

Never reboot or change the only Ethernet connection from an SSH-only session
without a recovery console (monitor or JetKVM).
Wake-on-LAN is configured in MS-A2 BIOS and on the selected NIC after network
testing. Fleet does not blindly edit Netplan on a university network.
Ansible and apt create a repeatable installation procedure, but packages
will move unless you pin versions/snapshots. Disk autoinstall is out of scope
until device names, encryption policy and backup recovery are confirmed.
