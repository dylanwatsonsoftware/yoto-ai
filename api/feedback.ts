export default async function handler(request: unknown, response: unknown) {
  const { default: handleFeedback } = await import("../catalogue-site/api/feedback.js");
  return handleFeedback(request, response);
}
