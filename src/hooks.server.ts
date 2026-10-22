import net from 'node:net';

// Node tries each address for only 250 ms before moving to the next. From far
// away (for example Australia to the OSRM server in Germany) the IPv4 connect
// takes longer, and fetch fails when IPv6 is unreachable.
net.setDefaultAutoSelectFamilyAttemptTimeout(2000);
