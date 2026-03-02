document.addEventListener("DOMContentLoaded", function () {

    const toggleBtn = document.querySelector(".toggle-password");
    const passwordInput = document.querySelector(".password-input");

    if (!toggleBtn || !passwordInput) return;

    toggleBtn.addEventListener("click", function () {

        if (passwordInput.type === "password") {
            passwordInput.type = "text";
            toggleBtn.classList.remove("fa-eye");
            toggleBtn.classList.add("fa-eye-slash");
        } else {
            passwordInput.type = "password";
            toggleBtn.classList.remove("fa-eye-slash");
            toggleBtn.classList.add("fa-eye");
        }

    });

});


