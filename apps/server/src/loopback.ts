/**
 * Validates client addresses used by the local-only initial setup route.
 */

/**
 * Returns whether a socket address belongs to an IPv4 or IPv6 loopback range.
 */
export const isLoopbackAddress = (address: string | undefined): boolean => {
  if (address === "::1" || address === "0:0:0:0:0:0:0:1") {
    return true;
  }

  const ipv4Address = address?.startsWith("::ffff:")
    ? address.slice("::ffff:".length)
    : address;

  return isIpv4LoopbackAddress(ipv4Address);
};

/**
 * Returns whether a dotted IPv4 address is within 127.0.0.0/8.
 */
const isIpv4LoopbackAddress = (address: string | undefined): boolean => {
  if (!address) {
    return false;
  }

  const octets = address.split(".");

  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => {
      if (!/^\d{1,3}$/.test(octet)) {
        return false;
      }

      const value = Number(octet);
      return value >= 0 && value <= 255;
    })
  );
};
