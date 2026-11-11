// Get the client
import mysql from 'mysql2/promise';
import express from 'express';
import bodyParser from 'body-parser';

const app = express();
const port = process.env.PORT || 3000;

const connection =  await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3309,
    user: process.env.DB_USER || 'feusi',
    password: process.env.DB_PASSWORD || 'feusi',
    database: process.env.DB_NAME || 'w3schools',
});


app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

app.use(bodyParser.json());

app.use((error, req, res, next) => {
    if (error.type !== 'entity.parse.failed') {
        return next(error);
    }
    res.status(400).json({error: `Invalid JSON in request body: ${error.message}`});
});

app.get('/', (req, res) => {
    res.json({message: 'This is a simple REST API for the w3schools database'});
})

const relations = [
    {
        name: "categories",
        id: "CategoryID"
    },
    {
        name: 'customers',
        id: 'customerID'
    },
    {
        name: "employees",
        id: "EmployeeID"
    },
    {
        name: "order_details",
        id: "OrderDetailID"
    },
    {
        name: "orders",
        id: "OrderID"
    },
    {
        name: "products",
        id: "ProductID"
    },
    {
        name: "shippers",
        id: "ShipperID"
    },
    {
        name: "suppliers",
        id: "SupplierID"
    }
]

function sendError(res, error) {
    console.error(error);
    if (error.sqlMessage) {
        return res.status(400).json({error: error.sqlMessage});
    }
    res.status(500).json({error: 'Internal Server Error'});
}

async function respondWithQuery(res, query, values) {
    try {
        const [rows] = await connection.query(query, values);
        res.json(rows);
    } catch (error) {
        sendError(res, error);
    }
}

function requireJsonBody(req, res, next) {
    if (Object.keys(req.body ?? {}).length > 0) {
        return next();
    }
    res.status(400).json({
        error: "Request body is empty or not JSON. Add the header 'Content-Type: application/json' and an empty line before the JSON body."
    });
}

for (let relation of relations) {
    app.get(`/${relation.name}`, (req, res) =>
        respondWithQuery(res, `SELECT * FROM ${relation.name}`)
    )

    app.get(`/${relation.name}/:id`, (req, res) =>
        respondWithQuery(res, `SELECT * FROM ${relation.name} WHERE ${relation.id} = ?`, [req.params.id])
    )

    app.post(`/${relation.name}`, requireJsonBody, (req, res) => {
        const columns = Object.keys(req.body);
        const query = `INSERT INTO ${relation.name} (${columns.join(', ')}) VALUES (${columns.map(_ => '?')})`;
        console.log(query)
        return respondWithQuery(res, query, Object.values(req.body));
    })

    app.patch(`/${relation.name}/:id`, requireJsonBody, (req, res) => {
        const assignments = Object.keys(req.body).map(k => k + " = ?").join(', ');
        const query = `UPDATE ${relation.name} SET ${assignments} WHERE ${relation.id} = ?`;
        console.log(query)
        return respondWithQuery(res, query, [...Object.values(req.body), req.params.id]);
    })

    app.delete(`/${relation.name}/:id`, (req, res) =>
        respondWithQuery(res, `DELETE FROM ${relation.name} WHERE ${relation.id} = ?`, [req.params.id])
    )
}
