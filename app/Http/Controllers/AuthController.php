<?php

namespace App\Http\Controllers;
use Illuminate\Support\Facades\Validator;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;


class AuthController extends Controller
{
    // LOGIN
    public function login(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required'
        ]);

        // 🔎 First check if user exists by email
        $user = User::where('email', $request->email)->first();

        if (!$user) {
            return back()->with('error', 'Invalid credentials');
        }

        // 🔐 Check password
        if (!Hash::check($request->password, $user->password)) {
            return back()->with('error', 'Invalid credentials');
        }

        // 🚫 Check if inactive
        if ($user->status === 'inactive') {
            return back()->with('error', 'Account is inactive');
        }

        // ✅ Login manually
        Auth::login($user, $request->remember);
        $request->session()->regenerate();

        if ($user->role === 'admin') {
            return redirect()->route('api.admin.overview');
        }

        return redirect()->route('api.user.overview');
    }


    // REGISTER
    public function register(Request $request)
    {
        // ================= VALIDATION =================
        $validator = Validator::make($request->all(), [
            'profile_picture' => 'nullable|image|mimes:jpg,jpeg,png|max:2048',
            'name' => 'required|string|max:255',
            'birthdate' => 'nullable|date',
            'address' => 'nullable|string|max:255',
            'phone' => 'required|string|max:20|unique:users,phone',
            'email' => 'required|email|max:255|unique:users,email',
            'password' => 'required|min:6|confirmed',
        ], [
            // Custom error messages
            'name.required' => 'Full name is required.',
            'email.required' => 'Email is required.',
            'email.email' => 'Please enter a valid email address.',
            'email.unique' => 'This email is already registered.',
            'phone.required' => 'Phone number is required.',
            'phone.unique' => 'This phone number is already registered.',
            'password.required' => 'Password is required.',
            'password.confirmed' => 'Passwords do not match.',
            'password.min' => 'Password must be at least 6 characters.',
        ]);

        // If validation fails, return JSON
        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'errors' => $validator->errors()
            ], 422);
        }


        // ================= HANDLE IMAGE UPLOAD =================
        $imagePath = null;

        if ($request->hasFile('profile_picture')) {
            $imagePath = $request->file('profile_picture')
                ->store('profile_pictures', 'public');
        }

        // ================= CREATE USER =================
        User::create([
            'profile_picture' => $imagePath,
            'name' => $request->name,
            'birthdate' => $request->birthdate,
            'address' => $request->address,
            'phone' => $request->phone,
            'email' => $request->email,
            'password' => Hash::make($request->password),
            'role' => 'user',
            'status' => 'active', // make sure new users are active
        ]);

        // ================= SUCCESS RESPONSE =================
        return response()->json([
            'success' => true,
            'message' => 'Registration successful.'
        ]);
    }


    public function verifyIdentity(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'phone' => 'required',
            'address' => 'required',
        ]);

        $user = User::where('email', $request->email)
            ->where('phone', $request->phone)
            ->where('address', $request->address)
            ->first();

        if (!$user) {
            return back()->with('error', 'Invalid credentials.');
        }

        session(['verified_user' => $user->id]);

        return redirect()->route('api.reset.form');
    }

    public function resetPassword(Request $request)
    {
        if (!session('verified_user')) {
            return response()->json([
                'success' => false,
                'message' => 'Session expired.'
            ]);
        }

        $validator = Validator::make($request->all(), [
            'password' => 'required|min:6|confirmed'
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => $validator->errors()->first()
            ]);
        }

        $user = User::find(session('verified_user'));

        if (!$user) {
            return response()->json([
                'success' => false,
                'message' => 'User not found.'
            ]);
        }

        $user->password = Hash::make($request->password);
        $user->save();

        session()->forget('verified_user');

        return response()->json([
            'success' => true,
            'message' => 'Password updated successfully.'
        ]);
    }

    public function changePassword(Request $request)
    {
        if (!Auth::check()) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthenticated.'
            ], 401);
        }

        $request->validate([
            'current_password' => 'required',
            'new_password' => 'required|min:6|confirmed',
        ]);

        $user = Auth::user();

        if (!Hash::check($request->current_password, $user->password)) {
            return response()->json([
                'success' => false,
                'message' => 'Current password is incorrect.'
            ], 400);
        }

        $user->password = Hash::make($request->new_password);
        $user->save();

        return response()->json([
            'success' => true,
            'message' => 'Password updated successfully.'
        ]);
    }


    public function updateUserProfile(Request $request)
    {
        if (!Auth::check()) {
            return response()->json([
                'success' => false
            ], 401);
        }

        $user = Auth::user();

        $request->validate([
            'profile_picture' => 'nullable|image|mimes:jpg,jpeg,png|max:2048',
        ]);

        if ($request->remove_image == "1") {
            if ($user->profile_picture &&
                Storage::disk('public')->exists($user->profile_picture)) {
                Storage::disk('public')->delete($user->profile_picture);
            }
            $user->profile_picture = null;
        }

        if ($request->hasFile('profile_picture')) {

            if ($user->profile_picture &&
                Storage::disk('public')->exists($user->profile_picture)) {
                Storage::disk('public')->delete($user->profile_picture);
            }

            $path = $request->file('profile_picture')
                ->store('profile_pictures', 'public');

            $user->profile_picture = $path;
        }

        $user->name = $request->input('name', $user->name);
        $user->phone = $request->input('phone', $user->phone);
        $user->email = $request->input('email', $user->email);
        $user->birthdate = $request->input('birthdate', $user->birthdate);
        $user->address = $request->input('address', $user->address);

        $user->save();

        return response()->json([
            'success' => true
        ]);
    }


    public function updateAdminProfile(Request $request)
    {
        if (!Auth::check()) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthenticated'
            ], 401);
        }

        $admin = Auth::user();

        $request->validate([
            'profile_picture' => 'nullable|image|mimes:jpg,jpeg,png|max:2048',
        ]);

        // ================= DELETE OLD IMAGE IF REMOVED =================
        if ($request->remove_image == "1") {

            if ($admin->profile_picture &&
                Storage::disk('public')->exists($admin->profile_picture)) {

                Storage::disk('public')->delete($admin->profile_picture);
            }

            $admin->profile_picture = null;
        }

        // ================= UPLOAD NEW IMAGE =================
        if ($request->hasFile('profile_picture')) {

            if ($admin->profile_picture &&
                Storage::disk('public')->exists($admin->profile_picture)) {

                Storage::disk('public')->delete($admin->profile_picture);
            }

            $path = $request->file('profile_picture')
                ->store('admin_profile_pictures', 'public');

            $admin->profile_picture = $path;
        }

        // ================= UPDATE EVERYTHING SENT =================
        $admin->name = $request->input('name', $admin->name);
        $admin->email = $request->input('email', $admin->email);
        $admin->phone = $request->input('phone', $admin->phone);
        $admin->address = $request->input('address', $admin->address);

        $admin->save();

        return response()->json([
            'success' => true,
            'message' => 'Profile updated successfully.'
        ]);
    }




    public function changeAdminPassword(Request $request)
    {
        $admin = Auth::user();

        $request->validate([
            'current_password' => 'required',
            'new_password' => 'required|min:6|confirmed',
        ]);

        if (!Hash::check($request->current_password, $admin->password)) {
            return response()->json([
                'success' => false,
                'message' => 'Current password incorrect'
            ], 400);
        }

        $admin->password = Hash::make($request->new_password);
        $admin->save();

        return response()->json(['success' => true]);
    }


}
