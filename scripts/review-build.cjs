// Every local review package starts with its own empty FrameUI profile.
// Reopening that same package keeps its work; building again creates a new one.
const { randomUUID } = require('node:crypto')
module.exports = async context => {
  context.packager.config.extraMetadata = {
    ...context.packager.config.extraMetadata,
    frameuiReviewProfile: `review-${Date.now()}-${randomUUID()}`,
  }
}
