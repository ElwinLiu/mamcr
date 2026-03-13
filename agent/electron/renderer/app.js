// Navigation controller — tab switching
document.addEventListener("DOMContentLoaded", () => {
	const navLinks = document.querySelectorAll(".nav-links a");
	const sections = document.querySelectorAll(".section");

	navLinks.forEach((link) => {
		link.addEventListener("click", (e) => {
			e.preventDefault();
			const tab = link.dataset.tab;

			navLinks.forEach((l) => l.classList.remove("active"));
			sections.forEach((s) => s.classList.remove("active"));

			link.classList.add("active");
			document.getElementById(tab).classList.add("active");
		});
	});
});

// Shared utility
function escapeHtml(str) {
	if (!str) return "";
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
