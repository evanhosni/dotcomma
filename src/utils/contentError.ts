/** A content mistake (a spec, a mount, a shader, a state machine) is loud where it is made: it throws
 *  outside production (dev and tests) and only logs in production, so a shipped build keeps running.
 *  Three-free: the server reports its own spec checks through it. */
export const reportContentError = (message: string): void => {
  if (process.env.NODE_ENV === "production") console.error(message);
  else throw new Error(message);
};
