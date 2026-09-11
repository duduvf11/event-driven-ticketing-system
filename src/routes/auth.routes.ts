import { Router } from "express";
import { UserRepository } from "../repositories/user.repository";
import { AuthService } from "../services/auth.service";
import { AuthController } from "../controllers/auth.controller";

const authRouter = Router();

const userRepository = new UserRepository();
const authService = new AuthService(userRepository);
const authController = new AuthController(authService);

authRouter.post('/register', (req, res, next) => authController.register(req, res, next));
authRouter.post('/login', (req, res, next) => authController.login(req, res, next));

export { authRouter };