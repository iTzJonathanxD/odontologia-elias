const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { Client } = require('pg');
const moment = require('moment');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const multer = require('multer');
const dns = require('dns').promises; // <-- Importar dns/promises
const fs = require('fs');

const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

// Configura la conexión a PostgreSQL
const client = new Client({
  connectionString:
    process.env.DATABASE_URL ||
    'postgres://postgres:S5QL0V126c4WMtKImkm3QTUjFKq83Tizb3BENmZAayBut2tDD9TIsgMT5fNInQv5@f8skogkc4wos8o8ccs444cks:5432/postgres',
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
});

// Función para crear tablas si no existen
async function crearTablasInicial() {
  try {
    // Crear tabla usuarios si no existe
    await client.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                foto_perfil VARCHAR(255),
                nombre VARCHAR(255) NOT NULL,
                correo VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                cedula VARCHAR(10),
                tipo_id VARCHAR(20),
                pasaporte VARCHAR(20),
                fecha_nacimiento DATE,
                edad INT,
                sexo CHAR(1),
                celular VARCHAR(20),
                ciudad VARCHAR(255),
                barrio VARCHAR(255),
                ocupacion VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reset_password_token VARCHAR(255),
                reset_password_expires TIMESTAMP,
                bloqueado BOOLEAN DEFAULT FALSE
            )
        `);

    // Crear tabla admin_credenciales si no existe
    await client.query(`
            CREATE TABLE IF NOT EXISTS admin_credenciales (
                id SERIAL PRIMARY KEY,
                usuario VARCHAR(255) NOT NULL UNIQUE,
                contraseña VARCHAR(255) NOT NULL,
                rol VARCHAR(50) NOT NULL DEFAULT 'administrador',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

    // Crear tabla citas si no existe
    await client.query(`
            CREATE TABLE IF NOT EXISTS citas (
                id SERIAL PRIMARY KEY,
                usuario_id INTEGER NOT NULL,
                tipo_documento VARCHAR(20),
                cedula VARCHAR(15) NOT NULL,
                nombre VARCHAR(100) NOT NULL,
                fecha DATE NOT NULL,
                hora TIME NOT NULL,
                especialidad VARCHAR(50) NOT NULL,
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
            )
        `);

    // Crear tabla historial_clinico si no existe
    await client.query(`
            CREATE TABLE IF NOT EXISTS historial_clinico (
                id SERIAL PRIMARY KEY,
                usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
                codigo_hc VARCHAR(100) NOT NULL,
                cedula VARCHAR(20) NOT NULL,
                codigo_diagnostico VARCHAR(10),
                nombre_diagnostico VARCHAR(255),
                nombre VARCHAR(255) NOT NULL,
                alergias TEXT,
                antecedentes_personales TEXT,
                antecedentes_familiares TEXT,
                medicamentos_actuales TEXT,
                cirugias TEXT,
                enfermedades_cronicas TEXT,
                grupo_sanguineo VARCHAR(3),
                fuma BOOLEAN,
                tipo_fuma VARCHAR(100),
                tipo_fuma_otros VARCHAR(100),
                alcohol BOOLEAN,
                enfermedades_contagiosas_recientes TEXT,
                odontograma_json TEXT,
                tratamientos TEXT,
                medicamentos TEXT,
                prescripcion TEXT,
                observaciones TEXT,
                seguimiento_de INTEGER REFERENCES historial_clinico(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

    // Crear tabla testimonios si no existe
    await client.query(`
            CREATE TABLE IF NOT EXISTS testimonios (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(255) NOT NULL,
                mensaje TEXT NOT NULL,
                foto_url VARCHAR(255),
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

    // Crear tabla notificaciones si no existe
    await client.query(`
            CREATE TABLE IF NOT EXISTS notificaciones (
                id SERIAL PRIMARY KEY,
                usuario_id INTEGER NOT NULL,
                mensaje TEXT NOT NULL,
                leida BOOLEAN DEFAULT FALSE,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
            )
        `);

    // Insertar usuarios admin por defecto si no existen
    const adminExists = await client.query(`
            SELECT COUNT(*) FROM admin_credenciales WHERE usuario IN ('Dra.Joseline', 'Recepcionista1')
        `);

    if (parseInt(adminExists.rows[0].count) === 0) {
      await client.query(`
                INSERT INTO admin_credenciales (usuario, contraseña, rol) VALUES
                ('Dra.Joseline', '12345', 'administrador'),
                ('Recepcionista1', '12345', 'recepcionista')
            `);
      console.log('✅ Usuarios admin creados: Dra.Joseline y Recepcionista1');
    }

    console.log('✅ Todas las tablas verificadas/creadas exitosamente');
  } catch (error) {
    console.error('❌ Error al crear tablas:', error);
  }
}

client
  .connect()
  .then(() => {
    console.log('Conectado a PostgreSQL');
    return client.query('SELECT 1');
  })
  .then(() => {
    console.log('Conexión verificada');
    return crearTablasInicial();
  })
  .catch((err) => {
    console.error('Error de conexión a PostgreSQL:', err);
    process.exit(1); // Salir si no se puede conectar
  });

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  '/testimonio',
  express.static(path.join(__dirname, 'public/testimonio'))
);
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// Función para validar registros MX del dominio del correo
async function validarCorreoMX(correo) {
  const dominio = correo.split('@')[1];
  try {
    const registros = await dns.resolveMx(dominio);
    return registros && registros.length > 0;
  } catch (error) {
    return false;
  }
}

// Configuración de sesión
app.use(
  session({
    secret: 'mi_secreto_seguro',
    resave: false,
    saveUninitialized: true,
  })
);

// Rutas
app.get('/', (req, res) => {
  res.render('home', { title: 'Historia Clínica Electrónica' });
});

app.get('/agendar-cita', (req, res) => {
  res.render('agendar-cita', { message: null, formData: {} });
});

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587, // Usa el puerto 587 para STARTTLS
  secure: false, // No usar SSL/TLS por defecto
  auth: {
    user: 'dra.joselinedelgado.consultorio@gmail.com',
    pass: 'ztac yqif dnnc mqxf',
  },
});

// Ruta para agendar cita
app.post('/agendar-cita', async (req, res) => {
  const { cedula, tipoDocumento, fecha, hora, especialidad } = req.body;

  if (!req.session.user) {
    return res.render('agendar-cita', {
      message: {
        type: 'danger',
        text: 'Debes iniciar sesión para agendar una cita.',
      },
      formData: req.body,
    });
  }

  try {
    const ahora = new Date();
    const citaFechaHora = new Date(`${fecha}T${hora}`);
    if (citaFechaHora <= ahora) {
      return res.render('agendar-cita', {
        message: {
          type: 'danger',
          text: 'No puedes agendar una cita en una fecha u hora pasada.',
        },
        formData: req.body,
      });
    }

    // Buscar paciente según tipo_id y columna correspondiente
    let pacienteQuery;
    if (tipoDocumento === 'nacional') {
      pacienteQuery = await client.query(
        'SELECT id, nombre, correo FROM usuarios WHERE cedula = $1 AND tipo_id = $2',
        [cedula, 'nacional']
      );
    } else if (tipoDocumento === 'extranjero') {
      pacienteQuery = await client.query(
        'SELECT id, nombre, correo FROM usuarios WHERE pasaporte = $1 AND tipo_id = $2',
        [cedula, 'extranjero']
      );
    } else {
      return res.render('agendar-cita', {
        message: { type: 'danger', text: 'Tipo de documento inválido.' },
        formData: req.body,
      });
    }

    if (pacienteQuery.rows.length === 0) {
      return res.render('agendar-cita', {
        message: { type: 'danger', text: 'Paciente no encontrado.' },
        formData: req.body,
      });
    }

    const paciente = pacienteQuery.rows[0];

    const citaExistente = await client.query(
      'SELECT COUNT(*) FROM citas WHERE fecha = $1 AND hora = $2',
      [fecha, hora]
    );

    if (parseInt(citaExistente.rows[0].count) > 0) {
      return res.render('agendar-cita', {
        message: {
          type: 'danger',
          text: 'Ya existe una cita agendada a esa hora.',
        },
        formData: req.body,
      });
    }

    // Guardar la cita con tipo_documento
    await client.query(
      'INSERT INTO citas (usuario_id, cedula, tipo_documento, nombre, fecha, hora, especialidad) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        paciente.id,
        cedula,
        tipoDocumento,
        paciente.nombre,
        fecha,
        hora,
        especialidad,
      ]
    );

    const mensaje = `Has agendado una cita para el ${fecha} a las ${hora} con la especialidad de ${especialidad}.`;
    await client.query(
      'INSERT INTO notificaciones (usuario_id, mensaje, leida) VALUES ($1, $2, $3)',
      [paciente.id, mensaje, false]
    );

    const mailPaciente = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: paciente.correo,
      subject: 'Confirmación de Cita Agendada',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <div style="text-align: center;">
                        <img src="http://localhost:4000/images/encabezado.png" alt="Logo Odontológico" style="max-width: 200px;">
                    </div>
                    <h2 style="text-align: center; color:rgb(76, 119, 175);">Confirmación de Cita Odontológica</h2>
                    <p style="font-size: 16px;">¡Hola <strong>${paciente.nombre}</strong>!</p>
                    <p style="font-size: 16px;">Tu cita ha sido agendada con éxito en el consultorio odontológico. Los detalles de tu cita son los siguientes:</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                    <p style="font-size: 16px;">¡Te esperamos a tiempo!</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Atentamente,</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Dra. Joseline Delgado</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Odontología Especializada</p>
                </div>`,
    };

    const mailDoctora = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: 'dra.joselinedelgado.consultorio@gmail.com',
      subject: 'Nueva Cita Agendada',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <h2 style="text-align: center; color:#b52e2e;">Nueva Cita Agendada</h2>
                    <p>Paciente: <strong>${paciente.nombre}</strong></p>
                    <ul>
                        <li><strong>Documento:</strong> ${tipoDocumento.toUpperCase()} - ${cedula}</li>
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                </div>`,
    };

    transporter.sendMail(mailPaciente, (err) => {
      if (err) console.error('Error al enviar correo al paciente:', err);
    });

    transporter.sendMail(mailDoctora, (err) => {
      if (err) console.error('Error al enviar correo a la doctora:', err);
    });

    return res.render('agendar-cita', {
      message: {
        type: 'success',
        text: '✅ Cita agendada correctamente. Se envió un correo de confirmación.',
      },
      formData: {},
    });
  } catch (err) {
    console.error('Error al agendar cita:', err);

    let errorMsg = 'Error interno del servidor.';
    if (err.code === '22P02') errorMsg = 'Formato incorrecto.';
    else if (err.code === '23503')
      errorMsg = 'Referencia inválida: usuario no encontrado.';

    return res.render('agendar-cita', {
      message: { type: 'danger', text: errorMsg },
      formData: req.body,
    });
  }
});

app.post('/agendar-cita-modal', async (req, res) => {
  const { fecha, hora, especialidad, tipoDocumento } = req.body;
  const usuario = req.session.user;

  if (!usuario) {
    return res
      .status(401)
      .json({
        success: false,
        message: 'Debes iniciar sesión para agendar una cita.',
      });
  }

  try {
    // Validar formato de fecha
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res
        .status(400)
        .json({ success: false, message: 'Fecha inválida.' });
    }

    // Validar formato de hora y convertirla a hh:mm:ss si es necesario
    let horaValida = hora;
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(hora)) {
      return res
        .status(400)
        .json({ success: false, message: 'Hora inválida.' });
    }
    if (!hora.includes(':00')) {
      horaValida += ':00';
    }

    // Validar que la fecha y hora no sean del pasado
    const ahora = new Date();
    const fechaHoraSeleccionada = new Date(`${fecha}T${horaValida}`);

    if (fechaHoraSeleccionada < ahora) {
      return res
        .status(400)
        .json({
          success: false,
          message: 'No puedes agendar una cita en el pasado.',
        });
    }

    // Verificar si ya hay una cita en esa fecha y hora
    const citaExistente = await client.query(
      'SELECT COUNT(*) FROM citas WHERE fecha = $1 AND hora = $2',
      [fecha, horaValida]
    );

    if (parseInt(citaExistente.rows[0].count) > 0) {
      return res.json({
        success: false,
        message: 'Ya hay una cita agendada a esa hora.',
      });
    }

    // Determinar el número de documento según tipo de documento
    let documento = '';
    if (tipoDocumento === 'nacional') {
      documento = usuario.cedula;
    } else if (tipoDocumento === 'extranjero') {
      documento = usuario.pasaporte;
    } else {
      return res
        .status(400)
        .json({ success: false, message: 'Tipo de documento inválido.' });
    }

    // Insertar la cita en la base de datos
    await client.query(
      'INSERT INTO citas (usuario_id, cedula, nombre, fecha, hora, especialidad, tipo_documento) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        usuario.id,
        documento,
        usuario.nombre,
        fecha,
        horaValida,
        especialidad,
        tipoDocumento,
      ]
    );

    // Insertar notificación para el paciente
    const mensaje = `Has agendado una cita para el ${fecha} a las ${hora} con la especialidad ${especialidad}.`;
    await client.query(
      'INSERT INTO notificaciones (usuario_id, mensaje, leida) VALUES ($1, $2, false)',
      [usuario.id, mensaje]
    );

    // Enviar correo al paciente
    const mailPaciente = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: usuario.correo,
      subject: 'Confirmación de Cita Agendada',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <div style="text-align: center;">
                        <img src="http://localhost:4000/images/encabezado.png" alt="Logo Odontológico" style="max-width: 200px;">
                    </div>
                    <h2 style="text-align: center; color:rgb(76, 119, 175);">Confirmación de Cita Odontológica</h2>
                    <p style="font-size: 16px;">¡Hola <strong>${usuario.nombre}</strong>!</p>
                    <p style="font-size: 16px;">Tu cita ha sido agendada con éxito en el consultorio odontológico. Los detalles de tu cita son los siguientes:</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                    <p style="font-size: 16px;">¡Te esperamos a tiempo!</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Atentamente,</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Dra. Joseline Delgado</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Odontología Especializada</p>
                </div>
            `,
    };

    // Enviar correo a la doctora
    const mailDoctora = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: 'dra.joselinedelgado.consultorio@gmail.com',
      subject: 'Nueva Cita Agendada por un Paciente',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <div style="text-align: center;">
                        <img src="http://localhost:4000/images/encabezado.png" alt="Logo Odontológico" style="max-width: 200px;">
                    </div>
                    <h2 style="text-align: center; color:rgb(76, 119, 175);">Nueva Cita Agendada</h2>
                    <p style="font-size: 16px;">El paciente <strong>${usuario.nombre}</strong> ha agendado una cita. Estos son los datos:</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Documento:</strong> ${documento}</li>
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                    <p style="font-size: 16px;">Puedes revisar los detalles desde el sistema.</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Dra. Joseline Delgado</p>
                </div>
            `,
    };

    transporter.sendMail(mailPaciente, (error, info) => {
      if (error) console.error('Error al enviar al paciente:', error);
      else console.log('Correo enviado al paciente:', info.response);
    });

    transporter.sendMail(mailDoctora, (error, info) => {
      if (error) console.error('Error al enviar a la doctora:', error);
      else console.log('Correo enviado a la doctora:', info.response);
    });

    return res.json({
      success: true,
      message: 'Cita agendada con éxito. Se enviaron correos de confirmación.',
    });
  } catch (err) {
    console.error('Error en /agendar-cita-modal:', err);
    return res.status(500).json({
      success: false,
      message: 'Error interno al guardar la cita.',
    });
  }
});

// GET para obtener datos de paciente por cédula
app.get('/obtener-datos-paciente', async (req, res) => {
  const { cedula, tipoDocumento } = req.query;

  if (!cedula || !tipoDocumento) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }

  try {
    let result;

    if (tipoDocumento === 'nacional') {
      result = await client.query(
        'SELECT nombre FROM usuarios WHERE cedula = $1 AND tipo_id = $2',
        [cedula, 'nacional']
      );
    } else if (tipoDocumento === 'extranjero') {
      result = await client.query(
        'SELECT nombre FROM usuarios WHERE pasaporte = $1 AND tipo_id = $2',
        [cedula, 'extranjero']
      );
    } else {
      return res.status(400).json({ error: 'Tipo de documento inválido' });
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }

    res.json({ nombre: result.rows[0].nombre });
  } catch (err) {
    console.error('Error al buscar paciente:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/citas-agendadas', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  try {
    const result = await client.query(
      'SELECT id, fecha, hora, especialidad FROM citas WHERE usuario_id = $1 ORDER BY fecha, hora',
      [req.session.user.id]
    );

    const message = req.query.message
      ? { text: req.query.message, type: req.query.type || 'info' }
      : null;

    res.render('citas-agendadas', {
      appointments: result.rows,
      message,
    });
  } catch (error) {
    console.error('Error al obtener citas:', error);
    res.render('citas-agendadas', {
      appointments: [],
      message: { text: 'Error al cargar citas', type: 'danger' },
    });
  }
});

app.post('/eliminar-cita', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const citaId = req.body.id;
  const usuarioId = req.session.user.id;

  if (!citaId) {
    return res.redirect(
      '/citas-agendadas?message=ID de cita inválido&type=danger'
    );
  }

  try {
    // Obtener los detalles de la cita
    const citaResult = await client.query(
      'SELECT nombre, fecha, hora, especialidad, usuario_id FROM citas WHERE id = $1',
      [citaId]
    );

    if (citaResult.rows.length === 0) {
      return res.redirect(
        '/citas-agendadas?message=No se encontró la cita o no tienes permiso para eliminarla&type=danger'
      );
    }

    const { nombre, fecha, hora, especialidad, usuario_id } =
      citaResult.rows[0];

    if (usuario_id !== usuarioId) {
      return res.redirect(
        '/citas-agendadas?message=No tienes permiso para eliminar esta cita&type=danger'
      );
    }

    const pacienteResult = await client.query(
      'SELECT correo, cedula FROM usuarios WHERE id = $1',
      [usuario_id]
    );

    if (pacienteResult.rows.length === 0) {
      return res.status(400).json({ error: 'Paciente no encontrado.' });
    }

    const correoPaciente = pacienteResult.rows[0].correo;
    const cedulaPaciente = pacienteResult.rows[0].cedula;

    // Eliminar la cita
    await client.query('DELETE FROM citas WHERE id = $1', [citaId]);

    // 📨 Correo al paciente
    const correoAlPaciente = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: correoPaciente,
      subject: 'Cancelación de Cita Odontológica',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <div style="text-align: center;">
                        <img src="http://localhost:4000/images/encabezado.png" alt="Logo Odontológico" style="max-width: 200px;">
                    </div>
                    <h2 style="text-align: center; color: #F44336;">Cancelación de Cita Odontológica</h2>
                    <p style="font-size: 16px;">¡Hola <strong>${nombre}</strong>!</p>
                    <p style="font-size: 16px;">Tu cita ha sido cancelada. Los detalles eran:</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                    <p style="font-size: 16px;">Si deseas reprogramarla, por favor contáctanos.</p>
                    <p style="font-size: 16px; font-weight: bold;">Atentamente,<br>Dra. Joseline Delgado<br>Odontología Especializada</p>
                </div>
            `,
    };

    // 📨 Correo a la doctora
    const correoADoctora = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: 'dra.joselinedelgado.consultorio@gmail.com',
      subject: 'Cita Cancelada por un Paciente',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <h2 style="text-align: center; color: #C62828;">Cita Cancelada</h2>
                    <p style="font-size: 16px;">El paciente ha cancelado una cita. Detalles:</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Nombre:</strong> ${nombre}</li>
                        <li><strong>Cédula:</strong> ${cedulaPaciente}</li>
                        <li><strong>Correo:</strong> ${correoPaciente}</li>
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                </div>
            `,
    };

    // Enviar ambos correos
    transporter.sendMail(correoAlPaciente, (error, info) => {
      if (error) {
        console.log('❌ Error al enviar al paciente:', error);
      } else {
        console.log(
          '✅ Correo de cancelación enviado al paciente:',
          info.response
        );
      }
    });

    transporter.sendMail(correoADoctora, (error, info) => {
      if (error) {
        console.log('❌ Error al enviar a la doctora:', error);
      } else {
        console.log(
          '✅ Correo de cancelación enviado a la doctora:',
          info.response
        );
      }
    });

    res.redirect(
      '/citas-agendadas?message=Cita eliminada correctamente. Un correo de cancelación ha sido enviado.&type=success'
    );
  } catch (error) {
    console.error('Error al eliminar la cita:', error);
    res.redirect(
      '/citas-agendadas?message=Error al eliminar la cita&type=danger'
    );
  }
});

// Mostrar formulario para editar cita
app.get('/editar-cita/:id', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const citaId = req.params.id;

  try {
    const result = await client.query(
      'SELECT * FROM citas WHERE id = $1 AND usuario_id = $2',
      [citaId, req.session.user.id]
    );

    if (result.rows.length === 0) {
      // Cita no encontrada o no pertenece al usuario
      return res.redirect('/citas-agendadas');
    }

    res.render('editar-cita', {
      appointment: result.rows[0],
      message: null,
    });
  } catch (error) {
    console.error('Error al obtener la cita:', error);
    return res.redirect('/citas-agendadas');
  }
});

// Procesar actualización de cita por parte del paciente
app.post('/editar-cita/:id', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const citaId = req.params.id;
  const { fecha, hora, especialidad } = req.body;

  try {
    // Verificar si ya existe otra cita con misma fecha y hora (excluyendo esta misma cita)
    const citaExistente = await client.query(
      `SELECT COUNT(*) FROM citas WHERE fecha = $1 AND hora = $2 AND id != $3`,
      [fecha, hora, citaId]
    );

    if (parseInt(citaExistente.rows[0].count) > 0) {
      // Cita ya existe en esa hora
      const citaResult = await client.query(
        'SELECT * FROM citas WHERE id = $1 AND usuario_id = $2',
        [citaId, req.session.user.id]
      );

      return res.render('editar-cita', {
        appointment: citaResult.rows[0],
        message: {
          type: 'danger',
          text: 'Ya existe una cita agendada para esa fecha y hora. Por favor, elige otro horario.',
        },
      });
    }

    // Actualizar la cita
    await client.query(
      `UPDATE citas SET fecha = $1, hora = $2, especialidad = $3 WHERE id = $4 AND usuario_id = $5`,
      [fecha, hora, especialidad, citaId, req.session.user.id]
    );

    // Obtener cita actualizada
    const citaResult = await client.query(
      'SELECT * FROM citas WHERE id = $1 AND usuario_id = $2',
      [citaId, req.session.user.id]
    );
    const appointment = citaResult.rows[0];

    // Obtener datos del usuario
    const userResult = await client.query(
      'SELECT nombre, cedula, correo FROM usuarios WHERE id = $1',
      [req.session.user.id]
    );
    const { nombre, cedula, correo } = userResult.rows[0];

    // 📨 Correo al paciente
    const correoAlPaciente = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: correo,
      subject: 'Actualización de Cita Odontológica',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <div style="text-align: center;">
                        <img src="http://localhost:4000/images/encabezado.png" alt="Logo Odontológico" style="max-width: 200px;">
                    </div>
                    <h2 style="text-align: center; color:rgb(76, 119, 175);">Cita Modificada</h2>
                    <p style="font-size: 16px;">¡Hola <strong>${nombre}</strong>!</p>
                    <p style="font-size: 16px;">Te informamos que los detalles de tu cita han sido actualizados. Estos son los nuevos datos:</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                    <p style="font-size: 16px;">Si necesitas hacer otra modificación, puedes hacerlo desde tu perfil.</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Atentamente,</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Dra. Joseline Delgado</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Odontología Especializada</p>
                </div>
            `,
    };

    // 📨 Correo a la doctora
    const correoADoctora = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: 'dra.joselinedelgado.consultorio@gmail.com',
      subject: 'Modificación de Cita por un Paciente',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <h2 style="text-align: center; color: #1976D2;">Cita Modificada por Paciente</h2>
                    <p style="font-size: 16px;">Un paciente ha modificado los datos de su cita. Detalles:</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Nombre:</strong> ${nombre}</li>
                        <li><strong>Cédula:</strong> ${cedula}</li>
                        <li><strong>Correo:</strong> ${correo}</li>
                        <li><strong>Nueva Fecha:</strong> ${fecha}</li>
                        <li><strong>Nueva Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                </div>
            `,
    };

    // Enviar ambos correos
    transporter.sendMail(correoAlPaciente, (error, info) => {
      if (error) {
        console.error('❌ Error al enviar al paciente:', error);
      } else {
        console.log(
          '✅ Correo de modificación enviado al paciente:',
          info.response
        );
      }
    });

    transporter.sendMail(correoADoctora, (error, info) => {
      if (error) {
        console.error('❌ Error al enviar a la doctora:', error);
      } else {
        console.log(
          '✅ Correo de modificación enviado a la doctora:',
          info.response
        );
      }
    });

    // Renderizar con éxito
    res.render('editar-cita', {
      appointment,
      message: {
        type: 'success',
        text: 'Cita actualizada correctamente. Se ha enviado un correo de confirmación.',
      },
    });
  } catch (error) {
    console.error('Error al actualizar cita:', error);

    const result = await client.query(
      'SELECT * FROM citas WHERE id = $1 AND usuario_id = $2',
      [citaId, req.session.user.id]
    );

    res.render('editar-cita', {
      appointment: result.rows[0],
      message: { type: 'danger', text: 'Error al actualizar la cita.' },
    });
  }
});

app.get('/obtener-citas', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  res.render('obtener-citas', {
    usuario: req.session.user, // ✅ Esto hace que <%= usuario.nombre %> funcione
  });
});

app.get('/obtener-citas-json', async (req, res) => {
  try {
    const { rows } = await client.query(
      'SELECT fecha, hora, especialidad FROM citas'
    );
    const citas = rows.map((row) => ({
      title: row.especialidad,
      start: `${row.fecha.toISOString().split('T')[0]}T${row.hora}`,
      allDay: false,
      estado: 'ocupado', // <-- aquí añadimos el estado para que el frontend pinte rojo
    }));
    res.json(citas);
  } catch (err) {
    console.error('Error al obtener citas JSON:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/citas-por-dia', async (req, res) => {
  try {
    const fecha = req.query.fecha; // formato: 'YYYY-MM-DD'

    if (!fecha) {
      return res.status(400).json({ error: 'Parámetro fecha requerido' });
    }

    // Consulta citas para la fecha dada ordenadas por hora
    const query = `
      SELECT hora, nombre AS nombre
      FROM citas
      WHERE fecha = $1
      ORDER BY hora
    `;

    const { rows } = await client.query(query, [fecha]);

    // Devuelve formato JSON esperado [{hora: "15:30:00", nombre: "Juan Pérez"}, ...]
    res.json(rows);
  } catch (error) {
    console.error('Error al obtener citas por día:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/obtener-citas', (req, res) => {
  res.render('obtener-citas'); // Solo renderiza HTML
});

app.get('/register', (req, res) => {
  res.render('register', { success: null, error: null });
});

// Ruta register ajustada con validación MX
app.post('/register', async (req, res) => {
  const { nombre, correo, password, tipo_id, cedula, fecha_nacimiento } =
    req.body;

  // Validación básica del correo
  const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailPattern.test(correo)) {
    return res.render('register', {
      success: null,
      error: 'Por favor, ingresa un correo electrónico válido.',
    });
  }

  const dominioValido = await validarCorreoMX(correo);
  if (!dominioValido) {
    return res.render('register', {
      success: null,
      error: 'El dominio del correo no tiene un servidor válido.',
    });
  }

  // Validar tipo y número de documento
  if (!tipo_id || !cedula) {
    return res.render('register', {
      success: null,
      error: 'Debes seleccionar tipo de identificación y número.',
    });
  }

  if (tipo_id === 'nacional' && !/^\d{10}$/.test(cedula)) {
    return res.render('register', {
      success: null,
      error: 'La cédula nacional debe tener 10 dígitos numéricos.',
    });
  }

  if (tipo_id === 'extranjero' && !/^[A-Za-z0-9]{5,20}$/.test(cedula)) {
    return res.render('register', {
      success: null,
      error:
        'El número de pasaporte debe tener entre 5 y 20 caracteres alfanuméricos.',
    });
  }

  try {
    // Verificar si ya existe el correo
    const existingUser = await client.query(
      'SELECT * FROM usuarios WHERE correo = $1',
      [correo]
    );
    if (existingUser.rows.length > 0) {
      return res.render('register', {
        success: null,
        error: 'El correo ya está registrado.',
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const cedulaDB = tipo_id === 'nacional' ? cedula : null;
    const pasaporteDB = tipo_id === 'extranjero' ? cedula : null;

    await client.query(
      `INSERT INTO usuarios (nombre, correo, password, tipo_id, cedula, pasaporte, fecha_nacimiento)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        nombre,
        correo,
        passwordHash,
        tipo_id,
        cedulaDB,
        pasaporteDB,
        fecha_nacimiento || null,
      ]
    );

    res.render('register', {
      success: 'Cuenta creada con éxito. Ahora puedes iniciar sesión.',
      error: null,
    });
  } catch (error) {
    console.error('Error al registrar usuario:', error);
    res.render('register', {
      success: null,
      error: 'Error del servidor. Intenta nuevamente.',
    });
  }
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { correo, password } = req.body;
  try {
    const result = await client.query(
      'SELECT * FROM usuarios WHERE correo = $1',
      [correo]
    );

    if (result.rows.length === 0) {
      return res.render('login', {
        error: 'Correo electrónico o contraseña incorrectos',
      });
    }

    const user = result.rows[0];

    // Verificar si el usuario está bloqueado
    if (user.bloqueado) {
      return res.render('login', {
        error: 'Cuenta bloqueada, contáctese con el administrador.',
      });
    }

    const isValid = await bcrypt.compare(password, user.password);

    if (!isValid) {
      return res.render('login', {
        error: 'Correo electrónico o contraseña incorrectos',
      });
    }

    req.session.user = {
      id: user.id,
      nombre: user.nombre,
      correo: user.correo,
      tipo_id: user.tipo_id,
      cedula: user.cedula,
      pasaporte: user.pasaporte,
    };

    res.redirect('/obtener-citas');
  } catch (error) {
    console.error('Error al iniciar sesión:', error);
    res.render('login', {
      error:
        'Ocurrió un error al iniciar sesión. Por favor, inténtalo de nuevo.',
    });
  }
});

app.get('/PaPrincipal', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  try {
    const result = await client.query(
      'SELECT nombre, mensaje, foto_url FROM testimonios ORDER BY creado_en DESC'
    );
    const testimonios = result.rows;

    res.render('PaPrincipal', {
      user: req.session.user,
      testimonios, // pasar testimonios completos a la vista
    });
  } catch (error) {
    console.error('Error al obtener testimonios:', error);
    res.render('PaPrincipal', {
      user: req.session.user,
      testimonios: [],
    });
  }
});

// Multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage });

// Ruta GET para mostrar formulario edición perfil
app.get('/EditPerfil', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  try {
    const userId = req.session.user.id;
    const result = await client.query('SELECT * FROM usuarios WHERE id = $1', [
      userId,
    ]);

    if (result.rowCount === 0) {
      return res.redirect('/perfil');
    }

    const user = result.rows[0];

    res.render('EditPerfil', {
      user: user,
      message: null,
    });
  } catch (error) {
    console.error('Error al obtener datos para editar perfil:', error);
    res.status(500).send('Error al cargar la página de edición de perfil.');
  }
});

app.post('/EditPerfil', upload.single('foto_perfil'), async (req, res) => {
  if (!req.session.user) {
    return res.status(401).render('EditPerfil', {
      user: null,
      message: {
        type: 'danger',
        text: 'Debes iniciar sesión para editar tu perfil',
      },
    });
  }

  try {
    const { sexo, fecha_nacimiento, edad, celular, ciudad, barrio, ocupacion } =
      req.body;

    const foto_perfil = req.file ? req.file.filename : null;

    let query = `
            UPDATE usuarios SET
                sexo = $1,
                fecha_nacimiento = $2,
                edad = $3,
                celular = $4,
                ciudad = $5,
                barrio = $6,
                ocupacion = $7
        `;

    const params = [
      sexo,
      fecha_nacimiento,
      edad,
      celular,
      ciudad,
      barrio,
      ocupacion,
    ];

    if (foto_perfil) {
      query += `, foto_perfil = $8 WHERE id = $9`;
      params.push(foto_perfil, req.session.user.id);
    } else {
      query += ` WHERE id = $8`;
      params.push(req.session.user.id);
    }

    await client.query(query, params);

    // Actualizar sesión
    Object.assign(req.session.user, {
      sexo,
      fecha_nacimiento,
      edad,
      celular,
      ciudad,
      barrio,
      ocupacion,
    });

    if (foto_perfil) {
      req.session.user.foto_perfil = foto_perfil;
    }

    res.render('EditPerfil', {
      user: req.session.user,
      message: { type: 'success', text: 'Perfil actualizado correctamente' },
    });
  } catch (error) {
    console.error('Error al actualizar perfil:', error);
    res.render('EditPerfil', {
      user: req.session.user,
      message: { type: 'danger', text: 'Error al actualizar el perfil' },
    });
  }
});

// Ruta GET para mostrar perfil
app.get('/perfil', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  try {
    const userId = req.session.user.id;
    const result = await client.query('SELECT * FROM usuarios WHERE id = $1', [
      userId,
    ]);
    if (result.rows.length === 0) {
      return res.redirect('/login');
    }
    const user = result.rows[0];
    res.render('perfil', { user });
  } catch (error) {
    console.error('Error al obtener perfil:', error);
    res.status(500).send('Error al obtener perfil');
  }
});

//Recuperar contraseña
app.get('/forgot-password', (req, res) => {
  res.render('forgot-password', { success: null, error: null });
});

app.post('/forgot-password', async (req, res) => {
  const { correo } = req.body;

  try {
    // Verificamos si el correo está registrado
    const result = await client.query(
      'SELECT * FROM usuarios WHERE correo = $1',
      [correo]
    );

    if (result.rows.length === 0) {
      return res.render('recuperar-password', {
        error: 'El correo electrónico no está registrado',
        success: null,
      });
    }

    // Generar token único
    const token = crypto.randomBytes(20).toString('hex');
    const expiration = new Date(Date.now() + 3600000); // 1 hora

    // Guardar token y fecha de expiración en la tabla usuarios
    await client.query(
      'UPDATE usuarios SET reset_password_token = $1, reset_password_expires = $2 WHERE correo = $3',
      [token, expiration, correo]
    );

    // Configuración del transporte de correo
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'dra.joselinedelgado.consultorio@gmail.com',
        pass: 'ztac yqif dnnc mqxf',
      },
    });

    // Contenido del correo
    const mailOptions = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: correo,
      subject: 'Recuperación de Contraseña',
      text: `Has solicitado restablecer tu contraseña.\n\nHaz clic en el siguiente enlace para continuar:\nhttp://localhost:4000/reset-password/${token}\n\nEste enlace expirará en 1 hora.`,
    };

    // Enviar correo
    await transporter.sendMail(mailOptions);

    // Mostrar mensaje de éxito
    res.render('forgot-password', {
      success:
        'Te hemos enviado un enlace de recuperación a tu correo. Serás redirigido al inicio de sesión.',
      error: null,
    });
  } catch (err) {
    console.error('Error al procesar recuperación de contraseña:', err);
    res.render('forgot-password', {
      error: 'Ocurrió un error al procesar tu solicitud. Intenta nuevamente.',
      success: null,
    });
  }
});

app.get('/reset-password', (req, res) => {
  res.render('reset-password', {
    error: 'No se proporcionó un token válido para el restablecimiento.',
    correo: null,
    token: null,
  });
});

app.post('/reset-password', async (req, res) => {
  const { correo, nuevaContraseña } = req.body;

  try {
    const result = await client.query(
      'SELECT * FROM usuarios WHERE correo = $1',
      [correo]
    );

    if (result.rows.length === 0) {
      return res.render('reset-password', {
        error: 'Correo no encontrado.',
        correo,
        token: null,
      });
    }

    const hashedPassword = await bcrypt.hash(nuevaContraseña, 10);

    await client.query(
      'UPDATE usuarios SET password = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE correo = $2',
      [hashedPassword, correo]
    );

    res.render('login', {
      success:
        'Contraseña actualizada correctamente. Ahora puedes iniciar sesión.',
      error: null,
    });
  } catch (error) {
    console.error('Error al actualizar la contraseña:', error);
    res.render('reset-password', {
      error: 'Ocurrió un error al actualizar la contraseña.',
      correo,
      token: null,
    });
  }
});

app.get('/reset-password/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const result = await client.query(
      'SELECT * FROM usuarios WHERE reset_password_token = $1 AND reset_password_expires > $2',
      [token, new Date()]
    );

    if (result.rows.length === 0) {
      return res.render('reset-password', {
        error: 'El enlace de recuperación es inválido o ha expirado.',
        correo: null,
        token: null,
      });
    }

    const correo = result.rows[0].correo;

    res.render('reset-password', {
      error: null,
      correo,
      token,
    });
  } catch (error) {
    console.error('Error al verificar el token:', error);
    res.render('reset-password', {
      error: 'Error interno al verificar el enlace de recuperación.',
      correo: null,
      token: null,
    });
  }
});

app.post('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  const { nuevaContraseña } = req.body;

  try {
    const result = await client.query(
      'SELECT * FROM usuarios WHERE reset_password_token = $1 AND reset_password_expires > $2',
      [token, new Date()]
    );

    if (result.rows.length === 0) {
      return res.render('reset-password', {
        error: 'El enlace ya no es válido o ha expirado.',
        correo: null,
        token: null,
      });
    }

    const hashedPassword = await bcrypt.hash(nuevaContraseña, 10);

    await client.query(
      'UPDATE usuarios SET password = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE reset_password_token = $2',
      [hashedPassword, token]
    );

    res.render('login', {
      success:
        'Tu contraseña ha sido restablecida con éxito. Ahora puedes iniciar sesión.',
      error: null,
    });
  } catch (error) {
    console.error('Error al restablecer contraseña:', error);
    res.render('reset-password', {
      error: 'Error al guardar la nueva contraseña.',
      correo: null,
      token,
    });
  }
});

// Rutas para Especialidades
app.get('/estetica', (req, res) => {
  res.render('estetica', { title: 'Estética Dental' });
});

app.get('/ortodoncia', (req, res) => {
  res.render('ortodoncia', { title: 'Ortodoncia - Odontología Especializada' });
});

app.get('/cirugia', (req, res) => {
  res.render('cirugia', {
    title: 'Cirugía e Implantes - Odontología Especializada',
  });
});
app.get('/otras', (req, res) => {
  res.render('otras', {
    title: 'Otras Especialidades - Odontología Especializada',
  });
});

//RUTAS DE ESPECIALIDADES QUE ESTÁN ADENTRO DE LA CUENTA
app.get('/Esteticaa', (req, res) => {
  res.render('Esteticaa', {
    title: 'Estética Dental - Odontología Especializada Dra. Josseline Delgado',
  });
});

app.get('/Ortodonciaa', (req, res) => {
  res.render('Ortodonciaa', {
    title: 'Ortodoncia - Odontología Especializada Dra. Josseline Delgado',
  });
});

app.get('/Cirugiaa', (req, res) => {
  res.render('Cirugiaa', {
    title: 'Cirugía Oral - Odontología Especializada Dra. Josseline Delgado',
  });
});

app.get('/OtrasEspee', (req, res) => {
  res.render('OtrasEspee', {
    title:
      'Otras Especialidades - Odontología Especializada Dra. Josseline Delgado',
  });
});

app.get('/calendario', (req, res) => {
  res.render('calendario');
});

app.get('/admin-login', (req, res) => {
  res.render('admin-login', { error: null }); // por si usas {{error}} en la vista
});

app.post('/admin-login', async (req, res) => {
  const { usuario, contraseña } = req.body;

  try {
    const result = await client.query(
      'SELECT * FROM admin_credenciales WHERE usuario = $1',
      [usuario]
    );
    if (result.rows.length === 0) {
      return res.render('admin-login', { error: 'Usuario no encontrado' });
    }

    const user = result.rows[0];

    if (user.contraseña === contraseña) {
      req.session.user = {
        id: user.id,
        usuario: user.usuario,
        rol: user.rol, // ✅ usar directamente desde la base
      };

      // Redirigir según el rol
      if (user.rol === 'administrador') {
        return res.redirect('/admin-home');
      } else if (user.rol === 'recepcionista') {
        return res.redirect('/admin-recepcionista');
      } else {
        return res.status(403).send('Rol no autorizado');
      }
    } else {
      return res.render('admin-login', { error: 'Contraseña incorrecta' });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).send('Error en el servidor');
  }
});

// Ruta GET para mostrar la página de inicio del administrador
app.get('/admin-home', async (req, res) => {
  try {
    // Obtiene las citas desde la base de datos
    const result = await client.query('SELECT * FROM citas');
    const appointments = result.rows;

    // Renderiza la vista con las citas
    res.render('admin-home', { appointments });
  } catch (error) {
    console.error('Error al obtener las citas:', error);
    res.status(500).send('Error al obtener las citas');
  }
});

//RECEPCIONISTA
app.get('/admin-recepcionista', (req, res) => {
  if (
    !req.session.user ||
    !req.session.user.rol ||
    req.session.user.rol.toLowerCase() !== 'recepcionista'
  ) {
    return res.status(403).send('Acceso no autorizado');
  }
  res.render('admin-recepcionista', { user: req.session.user });
});

// Ruta para mostrar las citas en admin-recepcionista-citas.ejs
app.get('/admin-recepcionista-citas', async (req, res) => {
  try {
    const result = await client.query(
      'SELECT * FROM citas ORDER BY fecha DESC, hora DESC'
    );
    res.render('admin-recepcionista-citas', {
      user: req.session.user,
      citas: result.rows,
    });
  } catch (error) {
    console.error('Error al obtener citas:', error);
    res.status(500).send('Error al cargar las citas');
  }
});
app.post('/recepcionista/citas/agregar', async (req, res) => {
  const {
    usuario_id,
    cedula,
    nombre,
    fecha,
    hora,
    especialidad,
    tipo_documento,
  } = req.body;

  try {
    // Verificar si ya existe una cita con la misma fecha y hora
    const existente = await client.query(
      `SELECT * FROM citas WHERE fecha = $1 AND hora = $2`,
      [fecha, hora]
    );

    if (existente.rows.length > 0) {
      return res
        .status(400)
        .json({ error: 'Ya existe una cita en esa fecha y hora.' });
    }

    // Insertar nueva cita
    await client.query(
      `INSERT INTO citas (usuario_id, cedula, nombre, fecha, hora, especialidad, tipo_documento)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [usuario_id, cedula, nombre, fecha, hora, especialidad, tipo_documento]
    );

    // Buscar el correo del paciente según el tipo de documento (cedula o pasaporte)
    const campoDocumento =
      tipo_documento === 'pasaporte' ? 'pasaporte' : 'cedula';
    const result = await client.query(
      `SELECT correo FROM usuarios WHERE ${campoDocumento} = $1`,
      [cedula]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Paciente no encontrado.' });
    }

    const correoPaciente = result.rows[0].correo;

    // 📨 Correo al paciente
    const correoAlPaciente = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: correoPaciente,
      subject: 'Confirmación de Cita Odontológica por Recepcionista',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <div style="text-align: center;">
                        <img src="http://localhost:4000/images/encabezado.png" alt="Logo Odontológico" style="max-width: 200px;">
                    </div>
                    <h2 style="text-align: center; color:rgb(76, 119, 175);">Confirmación de Cita Odontológica</h2>
                    <p style="font-size: 16px;">¡Hola <strong>${nombre}</strong>!</p>
                    <p style="font-size: 16px;">Tu cita ha sido agendada con éxito en el consultorio odontológico. Los detalles de tu cita son los siguientes:</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                    <p style="font-size: 16px;">¡Te esperamos a tiempo!</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Atentamente,</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Dra. Joseline Delgado</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Odontología Especializada</p>
                </div>
            `,
    };

    // 📨 Correo a la doctora
    const correoADoctora = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: 'dra.joselinedelgado.consultorio@gmail.com',
      subject: 'Nueva Cita Agendada por Recepcionista',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <h2 style="text-align: center; color: #1976D2;">Nueva Cita Agendada por Recepcionista</h2>
                    <p style="font-size: 16px;">Se ha registrado una nueva cita. Detalles:</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Nombre del Paciente:</strong> ${nombre}</li>
                        <li><strong>Cédula:</strong> ${cedula}</li>
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                        <li><strong>Correo del Paciente:</strong> ${correoPaciente}</li>
                    </ul>
                </div>
            `,
    };

    // Enviar correo al paciente
    transporter.sendMail(correoAlPaciente, (error, info) => {
      if (error) {
        console.log('❌ Error al enviar al paciente:', error);
      } else {
        console.log('✅ Correo enviado al paciente:', info.response);
      }
    });

    // Enviar correo a la doctora
    transporter.sendMail(correoADoctora, (error, info) => {
      if (error) {
        console.log('❌ Error al enviar a la doctora:', error);
      } else {
        console.log('✅ Correo enviado a la doctora:', info.response);
      }
    });

    // Respuesta al cliente
    res.json({
      success:
        'Cita guardada exitosamente. Se enviaron correos de confirmación.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar la cita.' });
  }
});

// EDITAR CITA
app.get('/recepcionista/citas/editar/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const result = await client.query('SELECT * FROM citas WHERE id = $1', [
      id,
    ]);
    if (result.rows.length > 0) {
      res.render('admin-recepcionista-editarCita', { cita: result.rows[0] });
    } else {
      res.redirect('/admin-recepcionista-citas');
    }
  } catch (error) {
    console.error(error);
    res.redirect('/admin-recepcionista-citas');
  }
});

app.post('/recepcionista/citas/editar/:id', async (req, res) => {
  const citaId = req.params.id;
  const { fecha, hora, especialidad } = req.body;

  // Verificar que los campos necesarios estén presentes
  if (!fecha || !hora || !especialidad) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }

  try {
    // Realizar la actualización de la cita en la base de datos
    const updateResult = await client.query(
      `UPDATE citas 
            SET fecha = $1, hora = $2, especialidad = $3
            WHERE id = $4`,
      [fecha, hora, especialidad, citaId]
    );

    // Verificar si se actualizó la cita correctamente
    if (updateResult.rowCount === 0) {
      return res.status(500).json({ error: 'No se pudo actualizar la cita' });
    }

    // Obtener la cita actualizada
    const citaResult = await client.query('SELECT * FROM citas WHERE id = $1', [
      citaId,
    ]);

    const updatedCita = citaResult.rows[0];

    // Buscar el correo del paciente usando el usuario_id
    const result = await client.query(
      `SELECT correo, nombre, tipo_id, cedula, pasaporte FROM usuarios WHERE id = $1`,
      [updatedCita.usuario_id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Paciente no encontrado.' });
    }

    const paciente = result.rows[0];
    const correoPaciente = paciente.correo;

    // 📨 Correo al paciente
    const correoAlPaciente = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: correoPaciente,
      subject: 'Actualización de Cita Odontológica',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <div style="text-align: center;">
                        <img src="http://localhost:4000/images/encabezado.png" alt="Logo Odontológico" style="max-width: 200px;">
                    </div>
                    <h2 style="text-align: center; color:rgb(76, 119, 175);">Cita Modificada</h2>
                    <p style="font-size: 16px;">¡Hola <strong>${paciente.nombre}</strong>!</p>
                    <p style="font-size: 16px;">Te informamos que los detalles de tu cita han sido actualizados. Estos son los nuevos datos:</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                    <p style="font-size: 16px;">Si necesitas hacer otra modificación, puedes hacerlo desde tu perfil.</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Atentamente,</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Dra. Joseline Delgado</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Odontología Especializada</p>
                </div>
            `,
    };

    // 📨 Correo a la doctora
    const correoADoctora = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: 'dra.joselinedelgado.consultorio@gmail.com',
      subject: 'Modificación de Cita por un Paciente',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <h2 style="text-align: center; color: #1976D2;">Cita Modificada por Paciente</h2>
                    <p style="font-size: 16px;">Un paciente ha modificado los detalles de su cita. Detalles:</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Nombre:</strong> ${paciente.nombre}</li>
                        <li><strong>Cédula:</strong> ${paciente.cedula}</li>
                        <li><strong>Correo:</strong> ${correoPaciente}</li>
                        <li><strong>Nueva Fecha:</strong> ${fecha}</li>
                        <li><strong>Nueva Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                </div>
            `,
    };

    // Enviar correo al paciente
    transporter.sendMail(correoAlPaciente, (error, info) => {
      if (error) {
        console.log('❌ Error al enviar al paciente:', error);
      } else {
        console.log('✅ Correo enviado al paciente:', info.response);
      }
    });

    // Enviar correo a la doctora
    transporter.sendMail(correoADoctora, (error, info) => {
      if (error) {
        console.log('❌ Error al enviar a la doctora:', error);
      } else {
        console.log('✅ Correo enviado a la doctora:', info.response);
      }
    });

    // Respuesta al cliente
    res.json({
      success:
        'Cita actualizada correctamente. Se enviaron correos de confirmación.',
      cita: updatedCita,
    });
  } catch (error) {
    console.error('Error al actualizar cita:', error);
    res.status(500).json({ error: 'Error al actualizar la cita' });
  }
});

// ELIMINAR CITA
app.delete('/recepcionista/citas/eliminar/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Obtener los detalles de la cita
    const citaResult = await client.query(
      'SELECT nombre, fecha, hora, especialidad, usuario_id FROM citas WHERE id = $1',
      [id]
    );

    if (citaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    const { nombre, fecha, hora, especialidad, usuario_id } =
      citaResult.rows[0];

    // Obtener correo del paciente
    const result = await client.query(
      'SELECT correo FROM usuarios WHERE id = $1',
      [usuario_id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Paciente no encontrado.' });
    }

    const correoPaciente = result.rows[0].correo;

    // Eliminar la cita
    await client.query('DELETE FROM citas WHERE id = $1', [id]);

    // Correo al paciente
    const correoAlPaciente = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: correoPaciente,
      subject: 'Cancelación de Cita Odontológica',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <div style="text-align: center;">
                        <img src="http://localhost:4000/images/encabezado.png" alt="Logo Odontológico" style="max-width: 200px;">
                    </div>
                    <h2 style="text-align: center; color:rgb(56, 148, 235);">Cancelación de Cita</h2>
                    <p style="font-size: 16px;">¡Hola <strong>${nombre}</strong>!</p>
                    <p style="font-size: 16px;">Te informamos que tu cita ha sido cancelada. Los detalles eran:</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                    <p style="font-size: 16px;">Puedes agendar una nueva cita cuando lo desees.</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Dra. Joseline Delgado</p>
                    <p style="font-size: 16px; font-weight: bold; margin: 0;">Odontología Especializada</p>
                </div>
            `,
    };

    // Correo a la doctora
    const correoADoctora = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: 'dra.joselinedelgado.consultorio@gmail.com',
      subject: 'Cita Cancelada por Recepcionista',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <h2 style="text-align: center; color: #d32f2f;">Notificación de Cancelación</h2>
                    <p style="font-size: 16px;">Una cita ha sido cancelada. Detalles:</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Paciente:</strong> ${nombre}</li>
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                        <li><strong>Correo del paciente:</strong> ${correoPaciente}</li>
                    </ul>
                </div>
            `,
    };

    // Enviar correos separados
    transporter.sendMail(correoAlPaciente, (error, info) => {
      if (error) {
        console.log('❌ Error al enviar correo al paciente:', error);
      } else {
        console.log(
          '✅ Correo de cancelación enviado al paciente:',
          info.response
        );
      }
    });

    transporter.sendMail(correoADoctora, (error, info) => {
      if (error) {
        console.log('❌ Error al enviar correo a la doctora:', error);
      } else {
        console.log(
          '✅ Correo de cancelación enviado a la doctora:',
          info.response
        );
      }
    });

    res.json({ success: 'Cita eliminada correctamente. Correos enviados.' });
  } catch (error) {
    console.error('Error al eliminar la cita:', error);
    res.status(500).json({ error: 'Error al eliminar la cita' });
  }
});

// Buscar usuario por cédula para autocompletar nombre e id usuario
app.get('/buscar-usuario', async (req, res) => {
  const { tipo, numero } = req.query;

  if (!tipo || !numero) {
    return res
      .status(400)
      .json({ error: 'Tipo y número de documento son requeridos' });
  }

  const campo = tipo === 'pasaporte' ? 'pasaporte' : 'cedula';

  try {
    const result = await client.query(
      `SELECT id as usuario_id, nombre || ' ' || apellido as nombre FROM usuarios WHERE ${campo} = $1`,
      [numero]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al buscar usuario:', error);
    res.status(500).json({ error: 'Error al buscar usuario' });
  }
});

app.get('/api/buscar-usuario', async (req, res) => {
  const { tipo, numero } = req.query;

  if (!tipo || !numero) {
    return res
      .status(400)
      .json({ error: 'Debe proporcionar tipo y número de documento.' });
  }

  // Validar tipo de documento permitido
  if (!['cedula', 'pasaporte'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo de documento inválido.' });
  }

  const campo = tipo === 'pasaporte' ? 'pasaporte' : 'cedula';

  try {
    const result = await client.query(
      `SELECT id, nombre FROM usuarios WHERE ${campo} = $1`,
      [numero]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado.' });
    }

    return res.json({
      id: result.rows[0].id,
      nombre: result.rows[0].nombre,
    });
  } catch (error) {
    console.error('Error al buscar usuario:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Ruta para mostrar el formulario de agregar administrador
app.get('/admin-crear', async (req, res) => {
  try {
    const { rows } = await client.query('SELECT * FROM admin_credenciales');
    res.render('admin-crear', { error: null, admins: rows });
  } catch (err) {
    console.error('Error al obtener administradores:', err);
    res.render('admin-crear', {
      error: 'Error al obtener los administradores',
    });
  }
});

app.post('/recepcionista/citas/agregar', async (req, res) => {
  const { usuario_id, cedula, nombre, fecha, hora, especialidad } = req.body;

  // Validar datos básicos (opcional)
  if (!usuario_id || !cedula || !nombre || !fecha || !hora || !especialidad) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }

  try {
    await client.query(
      `
      INSERT INTO citas (usuario_id, cedula, nombre, fecha, hora, especialidad)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
      [usuario_id, cedula, nombre, fecha, hora, especialidad]
    );

    res.json({ success: 'Cita agregada correctamente' });
  } catch (error) {
    console.error('Error al agregar cita:', error);
    res.status(500).json({ error: 'Error interno al guardar la cita' });
  }
});

app.post('/admin-crear', async (req, res) => {
  const { usuario, contraseña, rol } = req.body;

  if (!usuario || !contraseña || !rol) {
    const { rows } = await client.query('SELECT * FROM admin_credenciales');
    return res.render('admin-crear', {
      error: 'Completa todos los campos',
      admins: rows,
    });
  }

  try {
    await client.query(
      'INSERT INTO admin_credenciales (usuario, contraseña, rol) VALUES ($1, $2, $3)',
      [usuario, contraseña, rol]
    );

    const { rows } = await client.query('SELECT * FROM admin_credenciales');
    res.render('admin-crear', { error: null, admins: rows });
  } catch (err) {
    console.error('Error al agregar administrador:', err);
    const { rows } = await client.query('SELECT * FROM admin_credenciales');
    res.render('admin-crear', {
      error: 'Error al agregar el usuario',
      admins: rows,
    });
  }
});

app.get('/admin-editar/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await client.query(
      'SELECT * FROM admin_credenciales WHERE id = $1',
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).send('Administrador no encontrado');
    }
    res.render('admin-editar', {
      admin: result.rows[0],
      error: null,
      success: null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error del servidor');
  }
});

app.post('/admin-editar/:id', async (req, res) => {
  const { id } = req.params;
  const { usuario, contraseña } = req.body;

  if (!usuario || usuario.trim() === '') {
    return res.render('admin-editar', {
      admin: { id, usuario },
      error: 'El usuario es requerido.',
      success: null,
    });
  }

  try {
    const exists = await client.query(
      'SELECT 1 FROM admin_credenciales WHERE usuario = $1 AND id != $2',
      [usuario, id]
    );

    if (exists.rowCount > 0) {
      return res.render('admin-editar', {
        admin: { id, usuario },
        error: 'El usuario ya está en uso por otro administrador.',
        success: null,
      });
    }

    if (contraseña && contraseña.trim() !== '') {
      await client.query(
        'UPDATE admin_credenciales SET usuario = $1, contraseña = $2 WHERE id = $3',
        [usuario, contraseña, id]
      );
    } else {
      await client.query(
        'UPDATE admin_credenciales SET usuario = $1 WHERE id = $2',
        [usuario, id]
      );
    }

    // Obtener datos actualizados para mostrar en la vista
    const { rows } = await client.query(
      'SELECT * FROM admin_credenciales WHERE id = $1',
      [id]
    );

    res.render('admin-editar', {
      admin: rows[0],
      error: null,
      success: 'Administrador actualizado correctamente.',
    });
  } catch (error) {
    console.error('Error al editar administrador:', error);
    res.render('admin-editar', {
      admin: { id, usuario },
      error: 'Error interno del servidor.',
      success: null,
    });
  }
});

// Eliminar administrador
app.delete('/admin/eliminar/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Eliminar admin por id
    const result = await client.query(
      'DELETE FROM admin_credenciales WHERE id = $1',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Administrador no encontrado.' });
    }

    return res.json({ success: 'Administrador eliminado correctamente.' });
  } catch (error) {
    console.error('Error al eliminar administrador:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

app.get('/admin-obtener-citas', (req, res) => {
  res.render('admin-obtener-citas'); // Solo renderiza HTML
});

app.get('/api/citas', async (req, res) => {
  try {
    const { rows } = await client.query(
      'SELECT fecha, hora, especialidad FROM citas'
    );

    const events = rows.map((cita) => {
      const fecha = cita.fecha.toISOString().split('T')[0]; // "2025-05-23"
      const hora = cita.hora; // ya viene en formato "HH:MM:SS"
      const start = `
                        $ { fecha }
                        T$ { hora }
                        `;

      return {
        title: cita.especialidad,
        start: start,
      };
    });

    res.json(events);
  } catch (err) {
    console.error('Error al obtener citas:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/admin-obtener-citas-json', async (req, res) => {
  try {
    const { rows } = await client.query(
      'SELECT fecha, hora, especialidad FROM citas'
    );
    const citas = rows.map((row) => ({
      title: row.especialidad,
      start: `${row.fecha.toISOString().split('T')[0]}T${row.hora}`,
      allDay: false,
    }));
    res.json(citas);
  } catch (err) {
    console.error('Error al obtener citas JSON:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/admin-citas-dia/:fecha', async (req, res) => {
  const fecha = req.params.fecha; // formato yyyy-mm-dd
  try {
    const { rows } = await client.query(
      'SELECT nombre, cedula, hora, especialidad FROM citas WHERE fecha = $1 ORDER BY hora',
      [fecha]
    );
    res.render('admin-citas-dia', { fecha, citas: rows });
  } catch (err) {
    console.error('Error al obtener citas por fecha:', err);
    res.status(500).send('Error al obtener las citas del día');
  }
});

//pantalla de todas las citas
app.get('/admin-citas-agendadas', async (req, res) => {
  try {
    const citas = await client.query('SELECT * FROM citas');
    res.render('admin-citas-agendadas', {
      citas: citas.rows,
      error: req.query.error,
    });
  } catch (error) {
    console.error('Error al obtener citas:', error);
    res.render('admin-citas-agendadas', {
      error: 'Hubo un error al obtener las citas.',
    });
  }
});

app.get('/admin/odontograma', async (req, res) => {
  const doc = req.query.documento;

  try {
    const result = await client.query(
      `
            SELECT * FROM usuarios
            WHERE cedula = $1 OR pasaporte = $1
        `,
      [doc]
    );

    if (result.rows.length === 0) {
      return res.send(
        '<h3 class="text-center mt-4">Paciente no encontrado</h3>'
      );
    }

    const paciente = result.rows[0];

    const hc = await client.query(
      `
            SELECT * FROM historial_clinico
            WHERE usuario_id = $1
            ORDER BY created_at ASC
        `,
      [paciente.id]
    );

    if (hc.rows.length === 0) {
      return res.send(`
                <div class="container mt-5">
                    <div class="alert alert-warning text-center shadow-sm" role="alert" style="font-size: 1.2rem;">
                        🦷 <strong>No hay odontograma registrado para este paciente.</strong><br>
                        Por favor, verifique si ya se le ha creado un historial clínico.
                    </div>
                    <div class="text-center mt-4">
                        <a href="/admin-todos-historiales" class="btn btn-primary">Volver</a>
                    </div>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
                </div>
            `);
    }

    // Agrupar tratamientos por número de pieza
    const piezasAgrupadas = new Map();

    hc.rows.forEach((historial) => {
      try {
        const odontograma = historial.odontograma_json;

        if (Array.isArray(odontograma)) {
          odontograma.forEach((pieza) => {
            const key = pieza.numero;
            if (!piezasAgrupadas.has(key)) {
              piezasAgrupadas.set(key, []);
            }
            piezasAgrupadas.get(key).push({
              procedimiento: pieza.procedimiento,
              cara: pieza.cara,
            });
          });
        } else {
          console.warn(
            `Odontograma no es array válido en historial: ${historial.id}`
          );
        }
      } catch (e) {
        console.error(`Odontograma inválido en historial: ${historial.id}`);
      }
    });

    // Formatear para enviar al EJS
    const piezas = Array.from(piezasAgrupadas.entries()).map(
      ([numero, tratamientos]) => ({
        numero,
        tratamientos,
      })
    );

    res.render('admin-ver-odontograma', {
      paciente,
      piezas,
    });
  } catch (error) {
    console.error('Error al buscar odontograma:', error);
    res.status(500).send('Error interno del servidor.');
  }
});

app.get('/admin/historial-clinico/:usuario_id', async (req, res) => {
  const usuarioId = parseInt(req.params.usuario_id);

  try {
    const pacienteResult = await client.query(
      'SELECT id, nombre, cedula, pasaporte FROM usuarios WHERE id = $1',
      [usuarioId]
    );

    if (pacienteResult.rowCount === 0) {
      return res.status(404).send('Paciente no encontrado');
    }

    const paciente = pacienteResult.rows[0];

    // Obtener todos los historiales con odontograma del paciente
    const historialesResult = await client.query(
      `
            SELECT id, odontograma_json
            FROM historial_clinico
            WHERE usuario_id = $1 AND odontograma_json IS NOT NULL
            ORDER BY created_at ASC
        `,
      [usuarioId]
    );

    // Combinar todos los odontogramas en un solo array
    const piezasTratadas = historialesResult.rows.flatMap((h) => {
      try {
        return h.odontograma_json ? JSON.parse(h.odontograma_json) : [];
      } catch (err) {
        return [];
      }
    });

    // ✅ Leer archivo JSON con diagnósticos odontológicos
    const rutaDiagnosticos = path.join(
      __dirname,
      'public',
      'json',
      'diagnosticos_odontologia.json'
    );
    let diagnosticosJSON = [];

    try {
      diagnosticosJSON = JSON.parse(fs.readFileSync(rutaDiagnosticos, 'utf8'));
    } catch (err) {
      console.error(
        'Error leyendo el archivo de diagnósticos odontológicos:',
        err
      );
    }

    // ✅ Renderizar la vista incluyendo los diagnósticos
    res.render('admin-historial-clinica', {
      paciente,
      mensaje: null,
      piezasTratadas,
      diagnosticosJSON,
    });
  } catch (error) {
    console.error('Error al cargar historial clínico:', error);
    res.status(500).send('Error en el servidor');
  }
});

app.post('/admin/historial-clinico/:usuario_id/crear', async (req, res) => {
  const usuarioId = parseInt(req.params.usuario_id);
  const {
    codigo_hc,
    tratamientos,
    observaciones,
    odontograma_json, // Aquí se captura el JSON del odontograma
    medicamentos,
    prescripcion,
    codigo_diagnostico,
    nombre_diagnostico,
    grupo_sanguineo,
    alergias,
    antecedentes_personales,
    antecedentes_familiares,
    medicamentos_actuales,
    cirugias,
    enfermedades_cronicas,
    enfermedades_contagiosas_recientes,
    fuma,
    tipo_fuma,
    tipo_fuma_otros,
    alcohol,
  } = req.body;

  try {
    // Obtener el paciente de la base de datos
    const pacienteResult = await client.query(
      'SELECT * FROM usuarios WHERE id = $1',
      [usuarioId]
    );
    if (pacienteResult.rowCount === 0) {
      return res.status(404).send('Paciente no encontrado');
    }
    const paciente = pacienteResult.rows[0];

    // ✅ Usar cédula o pasaporte, lo que exista
    const documento = paciente.cedula || paciente.pasaporte;

    // Verificar que el JSON del odontograma se está recibiendo correctamente
    console.log('Odontograma JSON:', odontograma_json);

    // Si el JSON del odontograma está vacío o no contiene piezas tratadas, no lo guardamos
    const odontogramaParsed = JSON.parse(odontograma_json || '[]');

    if (odontogramaParsed.length === 0) {
      return res
        .status(400)
        .send('Debe seleccionar al menos una pieza tratada');
    }

    // Convertir a string solo las piezas seleccionadas (limpio)
    const odontogramaSoloTratadas = JSON.stringify(odontogramaParsed);

    // Luego en la consulta:
    await client.query(
      `INSERT INTO historial_clinico 
    (usuario_id, codigo_hc, cedula, nombre, tratamientos, medicamentos, prescripcion, observaciones, odontograma_json,
    codigo_diagnostico, nombre_diagnostico,
    grupo_sanguineo, alergias, antecedentes_personales, antecedentes_familiares,
    medicamentos_actuales, cirugias, enfermedades_cronicas, enfermedades_contagiosas_recientes,
    fuma, tipo_fuma, tipo_fuma_otros, alcohol) 
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 
            $10, $11, $12, $13, $14, $15, 
            $16, $17, $18, $19, 
            $20, $21, $22, $23)`,
      [
        usuarioId,
        codigo_hc,
        documento,
        paciente.nombre,
        tratamientos,
        medicamentos,
        prescripcion,
        observaciones,
        odontogramaSoloTratadas, // 👈 solo piezas tratadas
        codigo_diagnostico || null,
        nombre_diagnostico || null,
        grupo_sanguineo || null,
        alergias || null,
        antecedentes_personales || null,
        antecedentes_familiares || null,
        medicamentos_actuales || null,
        cirugias || null,
        enfermedades_cronicas || null,
        enfermedades_contagiosas_recientes || null,
        fuma === 'on',
        tipo_fuma || null,
        tipo_fuma_otros || null,
        alcohol === 'on',
      ]
    );

    // Redirigir con mensaje de éxito
    res.redirect(
      `/admin/historial-clinico/${usuarioId}?mensaje=Historial%20guardado%20correctamente&tipoMensaje=success`
    );
  } catch (error) {
    console.error('Error al crear historial clínico:', error);
    res.redirect(
      `/admin/historial-clinico/${usuarioId}?mensaje=Error%20al%20guardar%20el%20historial&tipoMensaje=error`
    );
  }
});

// Mostrar todos los historiales clínicos del paciente
app.get('/admin/historiales-clinicos/:usuario_id', async (req, res) => {
  const usuarioId = parseInt(req.params.usuario_id);

  try {
    const pacienteResult = await client.query(
      'SELECT * FROM usuarios WHERE id = $1',
      [usuarioId]
    );
    if (pacienteResult.rowCount === 0) {
      return res.status(404).send('Paciente no encontrado');
    }
    const paciente = pacienteResult.rows[0];

    // 🔍 Solo traer historiales principales, no los seguimientos
    const historialesResult = await client.query(
      'SELECT * FROM historial_clinico WHERE usuario_id = $1 AND seguimiento_de IS NULL ORDER BY created_at DESC',
      [usuarioId]
    );
    const historiales = historialesResult.rows;

    res.render('admin-lista-historiales', {
      paciente,
      historiales,
    });
  } catch (error) {
    console.error('Error al obtener historiales clínicos:', error);
    res.status(500).send('Error en el servidor');
  }
});

app.get(
  '/admin/historial-clinico/:usuario_id/seguimiento/:historial_id',
  async (req, res) => {
    const usuarioId = parseInt(req.params.usuario_id);
    const historialId = parseInt(req.params.historial_id);

    try {
      // Traer datos del paciente
      const pacienteResult = await client.query(
        'SELECT * FROM usuarios WHERE id = $1',
        [usuarioId]
      );
      if (pacienteResult.rowCount === 0) {
        return res.status(404).send('Paciente no encontrado');
      }
      const paciente = pacienteResult.rows[0];

      // Traer datos del historial original
      const historialResult = await client.query(
        'SELECT * FROM historial_clinico WHERE id = $1',
        [historialId]
      );
      if (historialResult.rowCount === 0) {
        return res.status(404).send('Historial clínico original no encontrado');
      }
      const historial = historialResult.rows[0];

      // Renderizar vista con datos precargados
      res.render('admin-historial-clinica-seguimiento', {
        paciente,
        historial,
      });
    } catch (error) {
      console.error('Error al cargar historial para seguimiento:', error);
      res.status(500).send('Error en el servidor');
    }
  }
);

app.get('/admin/editar-seguimiento/:id', async (req, res) => {
  const seguimientoId = parseInt(req.params.id);

  try {
    const result = await client.query(
      'SELECT * FROM historial_clinico WHERE id = $1',
      [seguimientoId]
    );
    if (result.rowCount === 0) {
      return res.status(404).send('Seguimiento no encontrado');
    }
    const seguimiento = result.rows[0];

    const pacienteResult = await client.query(
      'SELECT * FROM usuarios WHERE id = $1',
      [seguimiento.usuario_id]
    );
    const paciente = pacienteResult.rows[0];

    res.render('admin-editar-seguimiento', { seguimiento, paciente });
  } catch (error) {
    console.error('Error al cargar edición de seguimiento:', error);
    res.status(500).send('Error en el servidor');
  }
});

app.post('/admin/editar-seguimiento/:id', async (req, res) => {
  const seguimientoId = parseInt(req.params.id);
  const { tratamientos, observaciones, medicamentos, prescripcion } = req.body;

  try {
    await client.query(
      `
      UPDATE historial_clinico 
      SET tratamientos = $1,
          observaciones = $2,
          medicamentos = $3,
          prescripcion = $4,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
    `,
      [tratamientos, observaciones, medicamentos, prescripcion, seguimientoId]
    );

    const result = await client.query(
      'SELECT usuario_id FROM historial_clinico WHERE id = $1',
      [seguimientoId]
    );
    const usuarioId = result.rows[0].usuario_id;

    res.redirect(`/admin/historial-clinico/${usuarioId}/ver-seguimientos`);
  } catch (error) {
    console.error('Error al actualizar el seguimiento:', error);
    res.status(500).send('Error al guardar los cambios del seguimiento');
  }
});
app.get(
  '/admin/historial-clinico/:usuario_id/ver-seguimientos',
  async (req, res) => {
    const usuarioId = parseInt(req.params.usuario_id);

    try {
      // Obtener paciente
      const pacienteResult = await client.query(
        'SELECT * FROM usuarios WHERE id = $1',
        [usuarioId]
      );
      if (pacienteResult.rowCount === 0) {
        return res.status(404).send('Paciente no encontrado');
      }
      const paciente = pacienteResult.rows[0];

      // Obtener seguimientos que sean seguimiento_de de un historial
      const seguimientosResult = await client.query(
        `
      SELECT * FROM historial_clinico 
      WHERE seguimiento_de IS NOT NULL AND usuario_id = $1
      ORDER BY created_at DESC
    `,
        [usuarioId]
      );
      const seguimientos = seguimientosResult.rows;

      res.render('admin-ver-seguimientos', {
        paciente,
        seguimientos,
      });
    } catch (error) {
      console.error('Error al obtener seguimientos:', error);
      res.status(500).send('Error en el servidor');
    }
  }
);

app.post(
  '/admin/historial-clinico/:usuario_id/seguimiento/:id',
  async (req, res) => {
    const usuarioId = parseInt(req.params.usuario_id);
    const historialId = parseInt(req.params.id);

    const {
      codigo_hc,
      tratamientos,
      observaciones,
      prescripcion,
      medicamentos,
      fecha_seguimiento,
      seguimiento_de,
    } = req.body;

    try {
      const pacienteResult = await client.query(
        'SELECT * FROM usuarios WHERE id = $1',
        [usuarioId]
      );
      if (pacienteResult.rowCount === 0) {
        return res.status(404).send('Paciente no encontrado');
      }

      const paciente = pacienteResult.rows[0];
      const documento = paciente.cedula || paciente.pasaporte; // ✅ usa cédula o pasaporte

      // Insertar nuevo seguimiento en la tabla historial_clinico
      await client.query(
        `
            INSERT INTO historial_clinico (
                usuario_id, codigo_hc, cedula, nombre,
                tratamientos, observaciones, prescripcion, medicamentos,
                seguimiento_de, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        `,
        [
          usuarioId,
          codigo_hc,
          documento, // ✅ evita null en columna "cedula"
          paciente.nombre,
          tratamientos,
          observaciones,
          prescripcion,
          medicamentos,
          seguimiento_de,
        ]
      );

      res.redirect(
        `/admin/historial-clinico/${usuarioId}?mensaje=Seguimiento%20guardado%20correctamente&tipoMensaje=success`
      );
    } catch (error) {
      console.error('Error al guardar seguimiento:', error);
      res.redirect(
        `/admin/historial-clinico/${usuarioId}?mensaje=Error%20al%20guardar%20seguimiento&tipoMensaje=error`
      );
    }
  }
);

// Mostrar seguimientos de un historial clínico
app.get(
  '/admin/historial-clinico/:usuario_id/seguimientos/:historial_id',
  async (req, res) => {
    const usuarioId = parseInt(req.params.usuario_id);
    const historialId = parseInt(req.params.historial_id);

    try {
      const pacienteResult = await client.query(
        'SELECT * FROM usuarios WHERE id = $1',
        [usuarioId]
      );
      if (pacienteResult.rowCount === 0) {
        return res.status(404).send('Paciente no encontrado');
      }
      const paciente = pacienteResult.rows[0];

      const seguimientos = await client.query(
        'SELECT * FROM historial_clinico WHERE seguimiento_de = $1 ORDER BY created_at DESC',
        [historialId]
      );

      res.render('admin-historial-ver-seguimientos', {
        paciente,
        seguimientos: seguimientos.rows,
        historialId,
      });
    } catch (error) {
      console.error('Error al cargar seguimientos:', error);
      res.status(500).send('Error interno del servidor');
    }
  }
);

// Ruta para mostrar todos los historiales clínicos de un paciente
app.get(
  '/admin/historiales-clinicos/:usuario_id/imprimir',
  async (req, res) => {
    const usuarioId = parseInt(req.params.usuario_id);

    try {
      const pacienteResult = await client.query(
        'SELECT * FROM usuarios WHERE id = $1',
        [usuarioId]
      );
      if (pacienteResult.rowCount === 0) {
        return res.status(404).send('Paciente no encontrado');
      }
      const paciente = pacienteResult.rows[0];

      const historialesResult = await client.query(
        'SELECT * FROM historial_clinico WHERE usuario_id = $1 ORDER BY created_at DESC',
        [usuarioId]
      );
      const historiales = historialesResult.rows;

      res.render('admin-imprimir-todos-historiales', { paciente, historiales });
    } catch (error) {
      console.error('Error al imprimir historiales clínicos:', error);
      res.status(500).send('Error en el servidor');
    }
  }
);

app.get(
  '/admin/historial-clinico/:usuario_id/receta/:historial_id',
  async (req, res) => {
    const { usuario_id, historial_id } = req.params;
    try {
      const pacienteResult = await client.query(
        'SELECT * FROM usuarios WHERE id = $1',
        [usuario_id]
      );
      if (pacienteResult.rowCount === 0)
        return res.status(404).send('Paciente no encontrado');
      const paciente = pacienteResult.rows[0];

      const historialResult = await client.query(
        'SELECT * FROM historial_clinico WHERE id = $1 AND usuario_id = $2',
        [historial_id, usuario_id]
      );
      if (historialResult.rowCount === 0)
        return res.status(404).send('Historial clínico no encontrado');
      const historial = historialResult.rows[0];

      res.render('admin-imprimir-receta', { paciente, historial });
    } catch (error) {
      console.error('Error al obtener receta médica:', error);
      res.status(500).send('Error interno del servidor');
    }
  }
);

app.get(
  '/admin/historial-clinico/:usuario_id/editar/:historial_id',
  async (req, res) => {
    const { usuario_id, historial_id } = req.params;

    try {
      const pacienteResult = await client.query(
        'SELECT * FROM usuarios WHERE id = $1',
        [usuario_id]
      );
      if (pacienteResult.rowCount === 0)
        return res.status(404).send('Paciente no encontrado');
      const paciente = pacienteResult.rows[0];

      const historialResult = await client.query(
        'SELECT * FROM historial_clinico WHERE id = $1 AND usuario_id = $2',
        [historial_id, usuario_id]
      );
      if (historialResult.rowCount === 0)
        return res.status(404).send('Historial clínico no encontrado');
      const historial = historialResult.rows[0];

      res.render('admin-editar-historial', { paciente, historial });
    } catch (error) {
      console.error('Error en GET editar historial:', error);
      res.status(500).send('Error en el servidor');
    }
  }
);

app.post(
  '/admin/historial-clinico/:usuario_id/editar/:historial_id',
  async (req, res) => {
    const usuarioId = parseInt(req.params.usuario_id);
    const historialId = parseInt(req.params.historial_id);

    let {
      codigo_hc,
      tratamientos,
      observaciones,
      odontograma_json,
      medicamentos,
      prescripcion,
      codigo_diagnostico,
      nombre_diagnostico,
      alergias,
      antecedentes_personales,
      antecedentes_familiares,
      medicamentos_actuales,
      cirugias,
      enfermedades_cronicas,
      grupo_sanguineo,
      fuma,
      alcohol,
      enfermedades_contagiosas_recientes,
    } = req.body;

    try {
      const historialResult = await client.query(
        'SELECT * FROM historial_clinico WHERE id = $1 AND usuario_id = $2',
        [historialId, usuarioId]
      );

      if (historialResult.rowCount === 0) {
        return res.status(404).send('Historial clínico no encontrado');
      }

      // ✅ Validar y limpiar odontograma_json
      try {
        if (typeof odontograma_json === 'string') {
          const parsed = JSON.parse(odontograma_json);

          if (Array.isArray(parsed)) {
            if (typeof parsed[0] === 'string') {
              odontograma_json = parsed.map((str) => JSON.parse(str));
            } else {
              odontograma_json = parsed;
            }
          } else {
            odontograma_json = [];
          }
        }
      } catch (err) {
        console.error('❌ Error al limpiar odontograma_json:', err);
        odontograma_json = [];
      }

      // ✅ Ejecutar actualización
      await client.query(
        `
            UPDATE historial_clinico SET
                codigo_hc = $1,
                tratamientos = $2,
                medicamentos = $3,
                prescripcion = $4,
                observaciones = $5,
                odontograma_json = $6::jsonb,
                codigo_diagnostico = $7,
                nombre_diagnostico = $8,
                alergias = $9,
                antecedentes_personales = $10,
                antecedentes_familiares = $11,
                medicamentos_actuales = $12,
                cirugias = $13,
                enfermedades_cronicas = $14,
                grupo_sanguineo = $15,
                fuma = $16,
                alcohol = $17,
                enfermedades_contagiosas_recientes = $18
            WHERE id = $19 AND usuario_id = $20
        `,
        [
          codigo_hc,
          tratamientos,
          medicamentos,
          prescripcion,
          observaciones,
          JSON.stringify(odontograma_json), // ✅ convertido a string JSON válido
          codigo_diagnostico || null,
          nombre_diagnostico || null,
          alergias || null,
          antecedentes_personales || null,
          antecedentes_familiares || null,
          medicamentos_actuales || null,
          cirugias || null,
          enfermedades_cronicas || null,
          grupo_sanguineo || null,
          fuma === 'true' || false,
          alcohol === 'true' || false,
          enfermedades_contagiosas_recientes || null,
          historialId,
          usuarioId,
        ]
      );

      res.redirect(
        `/admin/historial-clinico/${usuarioId}?mensaje=Historial%20actualizado%20correctamente&tipoMensaje=success`
      );
    } catch (error) {
      console.error('❌ Error al editar historial clínico:', error);
      res.redirect(
        `/admin/historial-clinico/${usuarioId}?mensaje=Error%20al%20editar%20el%20historial&tipoMensaje=error`
      );
    }
  }
);

//Ruta POST para eliminar historial clínico (desde el modal)
app.post('/admin/historial-clinico/eliminar', async (req, res) => {
  const { id } = req.body;

  try {
    // Buscar el historial para obtener usuario_id y redirigir después
    const historialResult = await client.query(
      'SELECT usuario_id FROM historial_clinico WHERE id = $1',
      [id]
    );
    if (historialResult.rowCount === 0) {
      return res.status(404).send('Historial clínico no encontrado');
    }
    const usuarioId = historialResult.rows[0].usuario_id;

    // Eliminar historial
    await client.query('DELETE FROM historial_clinico WHERE id = $1', [id]);

    // Redirigir a lista de historiales del paciente
    res.redirect(`/admin/historiales-clinicos/${usuarioId}`);
  } catch (error) {
    console.error('Error al eliminar historial clínico:', error);
    res.status(500).send('Error en el servidor');
  }
});

//listar todos los historiales clinicos - panel home
app.get('/admin-todos-historiales', async (req, res) => {
  try {
    const result = await client.query(`
            SELECT hc.*, u.nombre 
            FROM historial_clinico hc 
            JOIN usuarios u ON hc.usuario_id = u.id 
            ORDER BY hc.created_at DESC
        `);

    res.render('admin-lista-historiales', { historiales: result.rows });
  } catch (error) {
    console.error('Error al obtener historiales clínicos:', error);
    res.status(500).send('Error al obtener los historiales clínicos');
  }
});

// ✅ Ruta para ver todos los pacientes y acceder a sus historiales clínicos
app.get('/admin-historiales-por-paciente', async (req, res) => {
  try {
    const result = await client.query(`
            SELECT id, nombre, tipo_id, cedula, pasaporte
            FROM usuarios
            ORDER BY nombre ASC
        `);

    const pacientes = result.rows || [];

    res.render('admin-historiales-por-paciente', {
      pacientes,
    });
  } catch (err) {
    console.error('Error al cargar pacientes:', err);
    res.status(500).send('Error interno del servidor');
  }
});

app.get('/admin/registrar-paciente-hc', (req, res) => {
  res.render('admin-registrar-paciente-hc', {
    error: null,
    success: null,
  });
});

app.get('/admin/citas-agendadas', async (req, res) => {
  try {
    // Consultar todas las citas agendadas en la base de datos
    const result = await client.query(
      'SELECT * FROM citas ORDER BY fecha, hora'
    );
    const citas = result.rows;

    // Renderizar la vista con las citas
    res.render('admin-citas-agendadas', { citas });
  } catch (error) {
    console.error('Error al obtener citas agendadas:', error);
    res.status(500).send('Error al obtener citas agendadas');
  }
});

// Suponiendo que 'client' es tu cliente de PostgreSQL ya configurado
app.post('/admin/citas/agregar', async (req, res) => {
  try {
    // Obtén todos los datos, incluyendo tipo_documento
    const {
      usuario_id,
      cedula,
      nombre,
      fecha,
      hora,
      especialidad,
      tipo_documento,
    } = req.body;

    // Verificar que los campos estén presentes
    if (
      !usuario_id ||
      !cedula ||
      !nombre ||
      !fecha ||
      !hora ||
      !especialidad ||
      !tipo_documento
    ) {
      return res
        .status(400)
        .json({ error: 'Todos los campos son obligatorios.' });
    }

    // Verificar si ya existe una cita a la misma hora y fecha con la misma especialidad
    const checkQuery = `
            SELECT COUNT(*) FROM citas
            WHERE fecha = $1 AND hora = $2 AND especialidad = $3
        `;
    const checkResult = await client.query(checkQuery, [
      fecha,
      hora,
      especialidad,
    ]);
    const count = parseInt(checkResult.rows[0].count);

    if (count > 0) {
      return res
        .status(400)
        .json({
          error:
            'Ya existe una cita agendada a esa fecha, hora y especialidad.',
        });
    }

    // Insertar la nueva cita en la base de datos, incluyendo tipo_documento
    const insertQuery = `
            INSERT INTO citas (usuario_id, cedula, nombre, fecha, hora, especialidad, tipo_documento)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
    await client.query(insertQuery, [
      usuario_id,
      cedula,
      nombre,
      fecha,
      hora,
      especialidad,
      tipo_documento,
    ]);

    // Obtener el correo del paciente
    const result = await client.query(
      'SELECT correo FROM usuarios WHERE cedula = $1',
      [cedula]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Paciente no encontrado.' });
    }
    const correoPaciente = result.rows[0].correo;

    // ✉️ Correo al paciente
    const correoAlPaciente = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: correoPaciente,
      subject: 'Confirmación de Cita Odontológica por Doctor(a)',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <div style="text-align: center;">
                        <img src="http://localhost:4000/images/encabezado.png" alt="Logo Odontológico" style="max-width: 200px;">
                    </div>
                    <h2 style="text-align: center; color:rgb(76, 119, 175);">Confirmación de Cita</h2>
                    <p style="font-size: 16px;">¡Hola <strong>${nombre}</strong>!</p>
                    <p style="font-size: 16px;">Tu cita ha sido agendada con éxito. Aquí están los detalles:</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                    <p style="font-size: 16px;">¡Te esperamos a tiempo!</p>
                    <p style="font-size: 16px; font-weight: bold;">Dra. Joseline Delgado<br>Odontología Especializada</p>
                </div>
            `,
    };

    // ✉️ Correo a la doctora
    const correoADoctora = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: 'dra.joselinedelgado.consultorio@gmail.com',
      subject: 'Nueva Cita Agendada por Doctor(a)',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <h2 style="color: #4a90e2;">Nueva Cita Registrada</h2>
                    <p><strong>Paciente:</strong> ${nombre}</p>
                    <p><strong>Cédula:</strong> ${cedula}</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                </div>
            `,
    };

    // Enviar correos por separado
    transporter.sendMail(correoAlPaciente, (error, info) => {
      if (error) {
        console.log('❌ Error al enviar al paciente:', error);
      } else {
        console.log('✅ Correo enviado al paciente:', info.response);
      }
    });

    transporter.sendMail(correoADoctora, (error, info) => {
      if (error) {
        console.log('❌ Error al enviar a la doctora:', error);
      } else {
        console.log('✅ Correo enviado a la doctora:', info.response);
      }
    });

    // Respuesta al cliente
    return res
      .status(200)
      .json({ success: 'Cita agendada correctamente. Correos enviados.' });
  } catch (error) {
    console.error('❌ Error al agregar cita:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

//Buscar nombre y usuario_id con la cedula
app.get('/buscar-usuario', async (req, res) => {
  const { cedula } = req.query;
  try {
    const result = await client.query(
      'SELECT id AS usuario_id, nombre FROM usuarios WHERE cedula = $1 LIMIT 1',
      [cedula]
    );
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'Paciente no encontrado' });
    }
  } catch (error) {
    console.error('Error al buscar paciente:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Ruta para buscar usuario por cédula o pasaporte en el backend
app.get('/admin/buscar-usuario', async (req, res) => {
  const { documento, tipoDocumento } = req.query;

  // Verifica si se recibió el tipo de documento y el número de documento
  if (!documento || !tipoDocumento) {
    return res
      .status(400)
      .json({
        success: false,
        message: 'Tipo de documento y número son obligatorios.',
      });
  }

  try {
    // Realizar la consulta para buscar el usuario por cédula o pasaporte
    let query;
    if (tipoDocumento === 'cedula') {
      query = 'SELECT id, nombre FROM usuarios WHERE cedula = $1 LIMIT 1';
    } else if (tipoDocumento === 'pasaporte') {
      query = 'SELECT id, nombre FROM usuarios WHERE pasaporte = $1 LIMIT 1';
    } else {
      return res
        .status(400)
        .json({ success: false, message: 'Tipo de documento no válido.' });
    }

    const result = await client.query(query, [documento]);

    if (result.rows.length > 0) {
      // Si se encuentra el usuario, devolver los datos
      const usuario = result.rows[0];
      return res.json({
        success: true,
        usuario: {
          id: usuario.id,
          nombre: usuario.nombre,
        },
      });
    } else {
      return res.json({ success: false, message: 'Usuario no encontrado.' });
    }
  } catch (error) {
    console.error('Error al buscar usuario:', error);
    res
      .status(500)
      .json({ success: false, message: 'Error al realizar la búsqueda.' });
  }
});

app.post('/admin/citas/agregar', async (req, res) => {
  try {
    // Obtén todos los datos, incluyendo tipo_documento
    const {
      usuario_id,
      cedula,
      nombre,
      fecha,
      hora,
      especialidad,
      tipo_documento,
    } = req.body;

    // Verificar que los campos estén presentes
    if (
      !usuario_id ||
      !cedula ||
      !nombre ||
      !fecha ||
      !hora ||
      !especialidad ||
      !tipo_documento
    ) {
      return res
        .status(400)
        .json({ error: 'Todos los campos son obligatorios.' });
    }

    // Verificar si ya existe una cita a la misma hora y fecha con la misma especialidad
    const checkQuery = `
            SELECT COUNT(*) FROM citas
            WHERE fecha = $1 AND hora = $2 AND especialidad = $3
        `;
    const checkResult = await client.query(checkQuery, [
      fecha,
      hora,
      especialidad,
    ]);
    const count = parseInt(checkResult.rows[0].count);

    if (count > 0) {
      return res
        .status(400)
        .json({
          error:
            'Ya existe una cita agendada a esa fecha, hora y especialidad.',
        });
    }

    // Insertar la nueva cita en la base de datos, incluyendo tipo_documento
    const insertQuery = `
            INSERT INTO citas (usuario_id, cedula, nombre, fecha, hora, especialidad, tipo_documento)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
    await client.query(insertQuery, [
      usuario_id,
      cedula,
      nombre,
      fecha,
      hora,
      especialidad,
      tipo_documento,
    ]);

    // Obtener el correo del paciente
    const result = await client.query(
      'SELECT correo FROM usuarios WHERE cedula = $1',
      [cedula]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Paciente no encontrado.' });
    }
    const correoPaciente = result.rows[0].correo;

    // ✉️ Correo al paciente
    const correoAlPaciente = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: correoPaciente,
      subject: 'Confirmación de Cita Odontológica por Doctor(a)',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <div style="text-align: center;">
                        <img src="http://localhost:4000/images/encabezado.png" alt="Logo Odontológico" style="max-width: 200px;">
                    </div>
                    <h2 style="text-align: center; color:rgb(76, 119, 175);">Confirmación de Cita</h2>
                    <p style="font-size: 16px;">¡Hola <strong>${nombre}</strong>!</p>
                    <p style="font-size: 16px;">Tu cita ha sido agendada con éxito. Aquí están los detalles:</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                    <p style="font-size: 16px;">¡Te esperamos a tiempo!</p>
                    <p style="font-size: 16px; font-weight: bold;">Dra. Joseline Delgado<br>Odontología Especializada</p>
                </div>
            `,
    };

    // ✉️ Correo a la doctora
    const correoADoctora = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: 'dra.joselinedelgado.consultorio@gmail.com',
      subject: 'Nueva Cita Agendada por Doctor(a)',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <h2 style="color: #4a90e2;">Nueva Cita Registrada</h2>
                    <p><strong>Paciente:</strong> ${nombre}</p>
                    <p><strong>Cédula:</strong> ${cedula}</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                </div>
            `,
    };

    // Enviar correos por separado
    transporter.sendMail(correoAlPaciente, (error, info) => {
      if (error) {
        console.log('❌ Error al enviar al paciente:', error);
      } else {
        console.log('✅ Correo enviado al paciente:', info.response);
      }
    });

    transporter.sendMail(correoADoctora, (error, info) => {
      if (error) {
        console.log('❌ Error al enviar a la doctora:', error);
      } else {
        console.log('✅ Correo enviado a la doctora:', info.response);
      }
    });

    // Respuesta al cliente
    return res
      .status(200)
      .json({ success: 'Cita agendada correctamente. Correos enviados.' });
  } catch (error) {
    console.error('❌ Error al agregar cita:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Ruta GET para mostrar formulario de edición de cita
app.get('/admin/citas/editar/:id', async (req, res) => {
  console.log('PUT /admin-editar/:id recibido');
  console.log('req.body:', req.body);
  const citaId = req.params.id;

  try {
    const result = await client.query('SELECT * FROM citas WHERE id = $1', [
      citaId,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).send('Cita no encontrada');
    }

    const cita = result.rows[0];

    // Renderiza la vista con la cita para editar
    res.render('admin-editar-cita', { cita, message: null });
  } catch (error) {
    console.error('Error al obtener la cita:', error);
    res.status(500).send('Error interno del servidor');
  }
});

app.post('/admin/citas/editar/:id', async (req, res) => {
  const id = req.params.id;
  const { fecha, hora, especialidad } = req.body;

  try {
    // Verificar si ya existe una cita para ese día y hora (excluyendo esta misma)
    const checkQuery = `
            SELECT COUNT(*) FROM citas
            WHERE fecha = $1 AND hora = $2 AND id <> $3
        `;
    const checkResult = await client.query(checkQuery, [fecha, hora, id]);
    const count = parseInt(checkResult.rows[0].count);

    if (count > 0) {
      return res.redirect(
        '/admin-citas-agendadas?error=Ya%20existe%20una%20cita%20agendada%20a%20esa%20fecha%20y%20hora.'
      );
    }

    // Actualizar la cita
    await client.query(
      'UPDATE citas SET fecha = $1, hora = $2, especialidad = $3 WHERE id = $4',
      [fecha, hora, especialidad, id]
    );

    // Obtener datos del paciente
    const citaResult = await client.query(
      'SELECT nombre, cedula FROM citas WHERE id = $1',
      [id]
    );

    if (citaResult.rows.length === 0) {
      return res.redirect(
        '/admin-citas-agendadas?error=No%20se%20encontró%20la%20cita.'
      );
    }

    const { nombre, cedula } = citaResult.rows[0];

    // Obtener correo del paciente
    const userResult = await client.query(
      'SELECT correo FROM usuarios WHERE cedula = $1',
      [cedula]
    );

    if (userResult.rows.length === 0) {
      return res.redirect(
        '/admin-citas-agendadas?error=Correo%20del%20paciente%20no%20encontrado.'
      );
    }

    const correoPaciente = userResult.rows[0].correo;

    // 📧 Correo para el paciente
    const correoPacienteOptions = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: correoPaciente,
      subject: 'Actualización de Cita Odontológica por Doctor(a)',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <div style="text-align: center;">
                        <img src="http://localhost:4000/images/encabezado.png" alt="Logo Odontológico" style="max-width: 200px;">
                    </div>
                    <h2 style="text-align: center; color:rgb(54, 152, 244);">Cita Reprogramada</h2>
                    <p style="font-size: 16px;">¡Hola <strong>${nombre}</strong>!</p>
                    <p style="font-size: 16px;">Tu cita ha sido modificada. Aquí los nuevos detalles:</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                    <p style="font-size: 16px;">Gracias por tu confianza.</p>
                    <p style="font-size: 16px; font-weight: bold;">Dra. Joseline Delgado<br>Odontología Especializada</p>
                </div>
            `,
    };

    // 📧 Correo para la doctora
    const correoDoctoraOptions = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: 'dra.joselinedelgado.consultorio@gmail.com',
      subject: 'Cita Actualizada por Doctor(a)',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <h2 style="text-align: center; color:rgb(54, 152, 244);">Cita Modificada</h2>
                    <p style="font-size: 16px;">Se ha actualizado la siguiente cita:</p>
                    <ul style="font-size: 16px;">
                        <li><strong>Paciente:</strong> ${nombre}</li>
                        <li><strong>Cédula:</strong> ${cedula}</li>
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                    <p style="font-size: 16px;">Este cambio ha sido realizado desde el panel administrativo.</p>
                </div>
            `,
    };

    // Enviar correos
    transporter.sendMail(correoPacienteOptions, (error, info) => {
      if (error) {
        console.error('❌ Error al enviar correo al paciente:', error);
      } else {
        console.log('✅ Correo enviado al paciente:', info.response);
      }
    });

    transporter.sendMail(correoDoctoraOptions, (error, info) => {
      if (error) {
        console.error('❌ Error al enviar correo a la doctora:', error);
      } else {
        console.log('✅ Correo enviado a la doctora:', info.response);
      }
    });

    // Redirección exitosa
    res.redirect(
      '/admin-citas-agendadas?success=Cita%20actualizada%20correctamente.'
    );
  } catch (error) {
    console.error('❌ Error al editar cita:', error);
    res.render('admin-editar-cita', {
      error: 'Error al actualizar cita.',
      cita: { id, fecha, hora, especialidad },
    });
  }
});

app.post('/admin/citas/eliminar', async (req, res) => {
  try {
    const citaId = req.body.id;
    const esDesdeHistorial = req.query.origen === 'historial';

    if (!citaId) {
      return res.status(400).send('ID de cita es requerido');
    }

    // Obtener los detalles de la cita
    const citaResult = await client.query(
      'SELECT cedula, nombre, fecha, hora, especialidad FROM citas WHERE id = $1',
      [citaId]
    );

    if (citaResult.rows.length === 0) {
      return res.status(404).send('Cita no encontrada');
    }

    const { cedula, nombre, fecha, hora, especialidad } = citaResult.rows[0];

    // Eliminar la cita (independientemente del origen)
    await client.query('DELETE FROM citas WHERE id = $1', [citaId]);

    // Si viene desde historial clínico, no se envían correos
    if (esDesdeHistorial) {
      return res
        .status(200)
        .json({ success: 'Cita eliminada desde historial sin notificación.' });
    }

    // Obtener correo del paciente
    const pacienteResult = await client.query(
      'SELECT correo FROM usuarios WHERE cedula = $1',
      [cedula]
    );

    if (pacienteResult.rows.length === 0) {
      return res.status(400).send('Paciente no encontrado');
    }

    const correoPaciente = pacienteResult.rows[0].correo;

    // Correo para el paciente
    const correoPacienteOptions = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: correoPaciente,
      subject: 'Cancelación de Cita Odontológica por Doctor(a)',
      html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <h2 style="text-align: center; color:rgb(54, 152, 244);">Cancelación de Cita Odontológica</h2>
                    <p>¡Hola <strong>${nombre}</strong>!</p>
                    <p>Lamentamos informarte que tu cita ha sido cancelada:</p>
                    <ul>
                        <li><strong>Fecha:</strong> ${fecha}</li>
                        <li><strong>Hora:</strong> ${hora}</li>
                        <li><strong>Especialidad:</strong> ${especialidad}</li>
                    </ul>
                    <p>Para reprogramarla, contáctanos.</p>
                </div>
            `,
    };

    // Correo para la doctora
    const correoDoctoraOptions = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: 'dra.joselinedelgado.consultorio@gmail.com',
      subject: 'Cita Cancelada por Doctor(a)',
      html: `
                <h2 style="color:rgb(54, 152, 244);">Cita Cancelada</h2>
                <p>Se canceló la cita:</p>
                <ul>
                    <li><strong>Paciente:</strong> ${nombre}</li>
                    <li><strong>Cédula:</strong> ${cedula}</li>
                    <li><strong>Fecha:</strong> ${fecha}</li>
                    <li><strong>Hora:</strong> ${hora}</li>
                    <li><strong>Especialidad:</strong> ${especialidad}</li>
                </ul>
            `,
    };

    // Enviar correos
    transporter.sendMail(correoPacienteOptions);
    transporter.sendMail(correoDoctoraOptions);

    res.redirect('/admin/citas-agendadas');
  } catch (error) {
    console.error('Error al eliminar cita:', error);
    res.status(500).send('Error al eliminar la cita');
  }
});

app.post('/admin/citas/eliminar/:id', async (req, res) => {
  try {
    const citaId = req.params.id;
    const esDesdeHistorial = req.query.origen === 'historial';

    if (!citaId) {
      return res.status(400).json({ error: 'ID de cita requerido' });
    }

    // Obtener datos de la cita
    const citaResult = await client.query(
      'SELECT cedula, nombre, fecha, hora, especialidad FROM citas WHERE id = $1',
      [citaId]
    );

    if (citaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    const { cedula, nombre, fecha, hora, especialidad } = citaResult.rows[0];

    // Eliminar cita
    await client.query('DELETE FROM citas WHERE id = $1', [citaId]);

    // Si viene del historial, no envía correo
    if (esDesdeHistorial) {
      return res
        .status(200)
        .json({ success: 'Cita eliminada desde historial clínico' });
    }

    // Obtener correo del paciente
    const pacienteResult = await client.query(
      'SELECT correo FROM usuarios WHERE cedula = $1',
      [cedula]
    );

    if (pacienteResult.rows.length === 0) {
      return res.status(400).json({ error: 'Paciente no encontrado' });
    }

    const correoPaciente = pacienteResult.rows[0].correo;

    // Correos
    const correoPacienteOptions = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: correoPaciente,
      subject: 'Cancelación de Cita Odontológica',
      html: `
                <p>Hola <strong>${nombre}</strong>, tu cita fue cancelada:</p>
                <ul>
                    <li>Fecha: ${fecha}</li>
                    <li>Hora: ${hora}</li>
                    <li>Especialidad: ${especialidad}</li>
                </ul>
            `,
    };

    const correoDoctoraOptions = {
      from: 'dra.joselinedelgado.consultorio@gmail.com',
      to: 'dra.joselinedelgado.consultorio@gmail.com',
      subject: 'Cita Cancelada',
      html: `
                <p>Paciente: <strong>${nombre}</strong> con cédula ${cedula} canceló su cita.</p>
                <p>Fecha: ${fecha} - Hora: ${hora} - Especialidad: ${especialidad}</p>
            `,
    };

    transporter.sendMail(correoPacienteOptions);
    transporter.sendMail(correoDoctoraOptions);

    res
      .status(200)
      .json({ success: 'Cita cancelada con notificación por correo' });
  } catch (error) {
    console.error('Error al eliminar cita:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

const storageTestimonio = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'public/testimonio'));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Nombre único con timestamp + extensión original
  },
});

const uploadTestimonio = multer({ storage: storageTestimonio });
// Obtener testimonios
app.get('/admin-testimonios', async (req, res) => {
  try {
    const result = await client.query(
      'SELECT * FROM testimonios ORDER BY creado_en DESC'
    );
    res.render('admin-testimonios', {
      testimonios: result.rows,
      message: null,
    });
  } catch (error) {
    console.error(error);
    res.render('admin-testimonios', {
      testimonios: [],
      message: { type: 'danger', text: 'Error al cargar testimonios' },
    });
  }
});

// Guardar testimonio
app.post(
  '/admin-testimonios',
  uploadTestimonio.single('foto'),
  async (req, res) => {
    const { nombre, mensaje } = req.body;
    let foto_url = null;
    if (req.file) {
      foto_url = req.file.filename;
    }
    try {
      await client.query(
        'INSERT INTO testimonios(nombre, mensaje, foto_url) VALUES($1, $2, $3)',
        [nombre, mensaje, foto_url]
      );
      res.redirect('/admin-testimonios');
    } catch (error) {
      console.error(error);
      res.redirect('/admin-testimonios');
    }
  }
);

// Editar testimonio
app.post(
  '/admin-testimonios/editar/:id',
  uploadTestimonio.single('foto'),
  async (req, res) => {
    const { id } = req.params;
    const { nombre, mensaje } = req.body;
    let query, params;
    if (req.file) {
      query =
        'UPDATE testimonios SET nombre=$1, mensaje=$2, foto_url=$3 WHERE id=$4';
      params = [nombre, mensaje, req.file.filename, id];
    } else {
      query = 'UPDATE testimonios SET nombre=$1, mensaje=$2 WHERE id=$3';
      params = [nombre, mensaje, id];
    }
    try {
      await client.query(query, params);
      res.redirect('/admin-testimonios');
    } catch (error) {
      console.error(error);
      res.redirect('/admin-testimonios');
    }
  }
);

// Eliminar testimonio
app.post('/admin-testimonios/eliminar/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await client.query('DELETE FROM testimonios WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.json({ success: false });
  }
});

//NOTIFICACION - guardar notificación cuando agendas cita
app.post('/api/citas', async (req, res) => {
  const usuario_id = req.session.user && req.session.user.id;
  console.log('ID del usuario desde sesión:', usuario_id);

  if (!usuario_id) {
    return res.status(401).json({ error: 'Usuario no autenticado' });
  }

  const { cedula, nombre, fecha, hora, especialidad } = req.body;

  try {
    const horaCorta = hora.substring(0, 5);
    const fechaObj = new Date(fecha);
    const fechaFormateada = fechaObj.toLocaleDateString('es-EC');

    const mensaje = `Usted agendó una cita para el ${fechaFormateada} a las ${horaCorta} con la Dra. Josselin Delgado`;

    // Guardar la cita
    await client.query(
      'INSERT INTO citas (usuario_id, cedula, nombre, fecha, hora, especialidad) VALUES ($1, $2, $3, $4, $5, $6)',
      [usuario_id, cedula, nombre, fecha, horaCorta, especialidad]
    );

    // Guardar la notificación
    await client.query(
      'INSERT INTO notificaciones (usuario_id, mensaje) VALUES ($1, $2)',
      [usuario_id, mensaje]
    );

    res.json({ mensaje });
  } catch (error) {
    console.error('Error al agendar cita:', error);
    res.status(500).json({ error: 'Error al guardar cita' });
  }
});

//Crear endpoint para traer notificaciones de un usuario:
app.get('/api/notificaciones/usuario', async (req, res) => {
  const usuario_id = req.session.user ? req.session.user.id : null;

  if (!usuario_id) {
    return res.status(401).json({ error: 'Usuario no autenticado' });
  }

  try {
    const result = await client.query(
      'SELECT id, mensaje, leida FROM notificaciones WHERE usuario_id = $1 ORDER BY fecha DESC',
      [usuario_id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener notificaciones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

//Endpoint para marcar una notificación como leída
app.put('/api/notificaciones/:id/leida', async (req, res) => {
  const { id } = req.params;

  try {
    await client.query('UPDATE notificaciones SET leida = TRUE WHERE id = $1', [
      id,
    ]);
    res.sendStatus(200);
  } catch (error) {
    console.error('Error al marcar como leída:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para buscar citas
app.get('/admin/citas/buscar', async (req, res) => {
  const query = req.query.query.trim();

  try {
    let citas;

    if (!query) {
      // Si el campo de búsqueda está vacío, obtener todas las citas
      citas = await client.query('SELECT * FROM citas');
    } else {
      // Filtrar por cédula o nombre
      citas = await client.query(
        `SELECT * FROM citas 
                WHERE cedula ILIKE $1 OR nombre ILIKE $1`,
        [`%${query}%`] // Parámetro de búsqueda (cédula o nombre)
      );
    }

    res.json({ citas: citas.rows });
  } catch (err) {
    console.error('Error al buscar citas:', err);
    res.status(500).json({ error: 'Error al buscar las citas' });
  }
});

// Ruta para mostrar la lista de usuarios
app.get('/admin-lista-usuarios', async (req, res) => {
  try {
    const result = await client.query('SELECT * FROM usuarios');
    const usuarios = result.rows;
    res.render('admin-lista-usuarios', { usuarios });
  } catch (error) {
    console.error('Error al obtener los usuarios:', error);
    res.status(500).send('Error al obtener los usuarios');
  }
});

app.get('/admin/usuarios', async (req, res) => {
  try {
    const result = await client.query('SELECT * FROM usuarios');
    const usuarios = result.rows;

    // Pasamos las variables success_msg y error_msg desde res.locals
    res.render('admin-lista-usuarios', {
      usuarios: usuarios,
      success_msg: res.locals.success_msg,
      error_msg: res.locals.error_msg,
    });

    // Limpiar después de pasar los mensajes
    delete res.locals.success_msg;
    delete res.locals.error_msg;
  } catch (error) {
    console.error('Error al obtener los usuarios:', error);
    res.status(500).send('Error al obtener los usuarios');
  }
});

// Ruta para eliminar un usuario
app.post('/admin/usuarios/eliminar', async (req, res) => {
  const { id } = req.body;

  try {
    await client.query('DELETE FROM usuarios WHERE id = $1', [id]);
    res.locals.success_msg = 'Cuenta eliminada con éxito';
    res.redirect('/admin/usuarios');
  } catch (error) {
    console.error('Error al eliminar el usuario:', error);
    res.locals.error_msg = 'Error al eliminar la cuenta';
    res.redirect('/admin/usuarios');
  }
});

// Ruta para bloquear un usuario
app.post('/admin/usuarios/bloquear', async (req, res) => {
  const { id } = req.body;

  try {
    // Actualiza el campo bloqueado a TRUE
    await client.query('UPDATE usuarios SET bloqueado = TRUE WHERE id = $1', [
      id,
    ]);
    res.locals.success_msg = 'Cuenta bloqueada con éxito';
    res.redirect('/admin/usuarios');
  } catch (error) {
    console.error('Error al bloquear el usuario:', error);
    res.locals.error_msg = 'Error al bloquear la cuenta';
    res.redirect('/admin/usuarios');
  }
});

// Ruta para desbloquear un usuario
app.post('/admin/usuarios/desbloquear', async (req, res) => {
  const { id } = req.body;

  try {
    // Actualiza el campo bloqueado a FALSE
    await client.query('UPDATE usuarios SET bloqueado = FALSE WHERE id = $1', [
      id,
    ]);
    res.locals.success_msg = 'Cuenta desbloqueada con éxito';
    res.redirect('/admin-lista-usuarios');
  } catch (error) {
    console.error('Error al desbloquear el usuario:', error);
    res.locals.error_msg = 'Error al desbloquear la cuenta';
    res.redirect('/admin/usuarios');
  }
});

app.post('/admin/usuarios/editar', async (req, res) => {
  const { id, nombre, correo, cedula, edad, sexo, celular } = req.body;

  if (!req.session.user || req.session.user.rol !== 'admin') {
    return res.redirect('/login');
  }

  try {
    const result = await client.query(
      `UPDATE usuarios 
             SET nombre = $1, correo = $2, cedula = $3, edad = $4, sexo = $5, celular = $6 
             WHERE id = $7`,
      [nombre, correo, cedula, edad, sexo, celular, id]
    );

    if (result.rowCount > 0) {
      res.redirect(
        '/admin-usuarios?mensaje=Usuario actualizado correctamente&type=success'
      );
    } else {
      res.redirect(
        '/admin-usuarios?mensaje=No se pudo actualizar el usuario&type=danger'
      );
    }
  } catch (error) {
    console.error('Error al editar usuario:', error);
    res.redirect('/admin-usuarios?mensaje=Error al editar usuario&type=danger');
  }
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Servidor en http://localhost:${PORT}`);
});
