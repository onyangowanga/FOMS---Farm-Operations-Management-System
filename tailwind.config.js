/** @type {import('tailwindcss').Config} */
export default {
  content: ["./client/**/*.html", "./client/**/*.js"],
  theme: {
    extend: {
      colors: {
        forest: { 50: "#eff7f0", 100: "#dceddf", 500: "#3d8752", 600: "#2f7042", 700: "#285a38", 900: "#173b27" },
        cream: "#f7f8f4"
      },
      boxShadow: {
        card: "0 3px 14px rgba(25, 55, 35, .05)"
      }
    }
  },
  plugins: []
};
